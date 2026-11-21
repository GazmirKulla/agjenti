import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { channelAdapter, type MessagingChannel } from "@/lib/conversations/channel";
import { isInstagramMessagingWindowOpen } from "@/lib/instagram/window";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";
import { zonedParts } from "./model";
import { recordSystem } from "@/lib/tracking/system-events";

const local = (instant: string, timezone: string) => { const p = zonedParts(instant, timezone); return `${p.date.split("-").reverse().join(".")} në ${p.time}`; };
async function timezoneOf(businessId: string) {
  const { data } = await createServiceSupabase().from("business_calendar_settings").select("timezone").eq("business_id", businessId).maybeSingle();
  return data?.timezone ?? "Europe/Tirane";
}

export type OwnerBookingNotice = { bookingId: string; conversationId: string; kind: "booked" | "requested" | "cancelled" | "moved"; previousStartsAt?: string; ref: string };
const ownerTitles: Record<OwnerBookingNotice["kind"], string> = {
  booked: "Rezervim i ri nga Agjenti", requested: "Kërkesë e re për rezervim, pret konfirmimin tënd",
  cancelled: "Klienti anuloi rezervimin", moved: "Klienti e zhvendosi rezervimin",
};

/** Tells the business's owners on Kreu (attention events) about every booking the agent made or changed, with a link. */
export async function notifyOwnerOfBooking(businessId: string, notice: OwnerBookingNotice) {
  if (isIsolatedExecution()) return;
  const db = createServiceSupabase();
  const [{ data: business }, { data: owners }, { data: booking }, timezone] = await Promise.all([
    db.from("businesses").select("slug").eq("id", businessId).maybeSingle(),
    db.from("business_users").select("user_id").eq("business_id", businessId).eq("role", "owner"),
    db.from("bookings").select("customer_name,service_name,starts_at,status").eq("business_id", businessId).eq("id", notice.bookingId).maybeSingle(),
    timezoneOf(businessId),
  ]);
  if (!business?.slug || !owners?.length || !booking) return;
  const sourceId = `booking:${notice.kind}:${notice.bookingId}:${notice.ref}`;
  const { data: existing } = await db.from("business_attention_events").select("user_id").eq("business_id", businessId).eq("source_id", sourceId);
  const notified = new Set((existing ?? []).map(row => row.user_id));
  const when = local(booking.starts_at, timezone);
  const detail = notice.kind === "moved" && notice.previousStartsAt ? `${booking.customer_name}, ${booking.service_name}: nga ${local(notice.previousStartsAt, timezone)} te ${when}.${booking.status === "pending" ? " Pret konfirmimin tënd." : ""}`
    : notice.kind === "cancelled" ? `${booking.customer_name}, ${booking.service_name}, ${when}. Orari u lirua.`
    : `${booking.customer_name}, ${booking.service_name}, ${when}.`;
  const rows = owners.filter(owner => !notified.has(owner.user_id)).map(owner => ({ business_id: businessId, user_id: owner.user_id, source_id: sourceId,
    title: ownerTitles[notice.kind], detail, href: `/b/${business.slug}/inbox/${notice.conversationId}` }));
  if (rows.length) await db.from("business_attention_events").insert(rows);
}

export type CustomerBookingMessage = "reminder" | "confirmed" | "cancelled" | "moved";
const customerText = (kind: CustomerBookingMessage, service: string, when: string) => ({
  reminder: `Kujtesë: sot keni rezervim për ${service}, ${when}. Nëse nuk vini dot, na shkruani këtu.`,
  confirmed: `Rezervimi juaj për ${service}, ${when}, u konfirmua.`,
  cancelled: `Rezervimi juaj për ${service}, ${when}, u anulua nga biznesi. Na shkruani nëse doni një orë tjetër.`,
  moved: `Rezervimi juaj për ${service} u zhvendos: ${when}. Na shkruani nëse ky orar nuk ju përshtatet.`,
})[kind];

/**
 * Tells the customer about their booking in the conversation it was made in, once per dedupe key, and only
 * inside the 24-hour messaging window (Instagram and WhatsApp allow automated messages only then; no
 * message tags, no templates). Outside it nothing is sent and the row says why.
 */
export async function messageCustomerAboutBooking(businessId: string, bookingId: string, kind: CustomerBookingMessage, dedupeKey: string, now = new Date()) {
  if (isIsolatedExecution()) return "skipped";
  const db = createServiceSupabase();
  const { data: booking } = await db.from("bookings").select("id,conversation_id,service_name,starts_at,status").eq("business_id", businessId).eq("id", bookingId).maybeSingle();
  if (!booking?.conversation_id) return "skipped";
  const { data: conversation } = await db.from("conversations")
    .select("id,channel,instagram_participant_id,instagram_connection_id,whatsapp_participant_id,whatsapp_connection_id,last_inbound_at")
    .eq("business_id", businessId).eq("id", booking.conversation_id).maybeSingle();
  if (!conversation || !["instagram", "whatsapp"].includes(conversation.channel)) return "skipped";
  const channel = conversation.channel as MessagingChannel;
  const adapter = channelAdapter(channel);
  const connectionId = channel === "whatsapp" ? conversation.whatsapp_connection_id : conversation.instagram_connection_id;
  const participant = channel === "whatsapp" ? conversation.whatsapp_participant_id : conversation.instagram_participant_id;
  const open = isInstagramMessagingWindowOpen(conversation.last_inbound_at, now);
  const claim = await db.from("booking_customer_messages").insert({ business_id: businessId, booking_id: bookingId, conversation_id: conversation.id, kind,
    dedupe_key: dedupeKey, connection_id: connectionId, participant_id: participant, status: open && connectionId && participant ? "sending" : "skipped",
    reason: open ? (connectionId && participant ? null : "no_channel") : "window_closed" }).select("id,status").maybeSingle();
  // Already handled (a unique dedupe key): never sent twice.
  if (claim.error || !claim.data) return "duplicate";
  const ref = `${kind}:${bookingId}`;
  if (claim.data.status === "skipped") { await recordSystem("system.booking_message", "skipped_window", { businessId, ref, reason: open ? "no_channel" : "window_closed" }); return "skipped"; }
  const finish = async (status: "sent" | "failed", fields: Record<string, unknown> = {}) => {
    await db.from("booking_customer_messages").update({ status, updated_at: new Date().toISOString(), ...fields }).eq("id", claim.data!.id);
    await recordSystem("system.booking_message", status, { businessId, ref, ...(status === "failed" ? { reason: String(fields.reason ?? "failed") } : {}) });
  };
  try {
    const { data: connection } = await db.from(adapter.table).select(`id,access_token_ciphertext,${adapter.account},status`).eq("id", connectionId).eq("business_id", businessId).maybeSingle();
    const row = connection as unknown as Record<string, unknown> | null;
    if (!row || row.status !== "connected") { await finish("failed", { reason: "disconnected" }); return "failed"; }
    const body = customerText(kind, booking.service_name, local(booking.starts_at, await timezoneOf(businessId)));
    const sent = await adapter.send({ accountId: String(row[adapter.account]), token: decryptSecret(String(row.access_token_ciphertext)), to: String(participant), body });
    if (!sent.ok || !sent.messageId) { await finish("failed", { reason: sent.ok ? "receipt_missing" : ("code" in sent && sent.code) || "provider_error" }); return "failed"; }
    // Stored in the conversation, so the inbox and the agent's history show it and its echo is recognised.
    await db.from("messages").insert({ business_id: businessId, conversation_id: conversation.id, direction: "outbound", source: "agent", body,
      external_message_id: sent.messageId, delivery_status: "sent", ...(channel === "whatsapp" ? { whatsapp_connection_id: connectionId } : { instagram_connection_id: connectionId }) });
    await finish("sent", { external_message_id: sent.messageId });
    return "sent";
  } catch {
    // A lost acknowledgement is never retried: the row stays and keeps the dedupe key.
    await finish("failed", { reason: "uncertain" });
    return "failed";
  }
}

/** A staff change the customer should hear about: confirmed, cancelled or moved. Null when nothing they need to know changed. */
export function staffChangeKind(before: { status: string; starts_at: string } | null, after: { status: string; starts_at: string }): Exclude<CustomerBookingMessage, "reminder"> | null {
  if (!before || before.status === "cancelled") return null;
  if (after.status === "cancelled") return "cancelled";
  if (Date.parse(before.starts_at) !== Date.parse(after.starts_at)) return "moved";
  if (before.status === "pending" && after.status === "confirmed") return "confirmed";
  return null;
}

/**
 * The morning job: a reminder for each booking made in a conversation that starts later today (business
 * time), only when the customer's messaging window is still open. Returns how many were sent and skipped.
 */
export async function sendBookingReminders(now = new Date()) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("bookings").select("id,business_id,starts_at")
    .in("status", ["pending", "confirmed"]).not("conversation_id", "is", null)
    .gt("starts_at", now.toISOString()).lt("starts_at", new Date(now.getTime() + 30 * 3600000).toISOString()).limit(500);
  if (error) throw new Error("booking_reminders_unavailable");
  const businesses = [...new Set((data ?? []).map(row => row.business_id))];
  const settings = businesses.length ? await db.from("business_calendar_settings").select("business_id,timezone").in("business_id", businesses) : { data: [], error: null };
  if (settings.error) throw new Error("booking_reminders_unavailable");
  const zones = new Map((settings.data ?? []).map(row => [row.business_id, row.timezone as string]));
  const result = { sent: 0, skipped: 0, failed: 0 };
  for (const row of data ?? []) {
    const timezone = zones.get(row.business_id) ?? "Europe/Tirane";
    if (zonedParts(row.starts_at, timezone).date !== zonedParts(now, timezone).date) continue;
    const outcome = await messageCustomerAboutBooking(row.business_id, row.id, "reminder", `reminder:${row.id}:${row.starts_at}`, now);
    if (outcome === "sent") result.sent++; else if (outcome === "failed") result.failed++; else if (outcome === "skipped") result.skipped++;
  }
  return result;
}
