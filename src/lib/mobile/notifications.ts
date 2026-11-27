import { recordSystem, stepFailure } from "@/lib/tracking/system-events";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireBusinessAccess } from "@/lib/tenant/access";
type Delivery = {
  id: string;
  event_id: string;
  token: string;
  attempts: number;
  receipt_id: string | null;
};
type ExpoReply = { status: string; id?: string; details?: { error?: string } };
/** A push the Expo service refused, named by Expo's own code so the failure can be found ("expo_invalid_credentials"). */
class PushError extends Error {
  constructor(readonly failure: string) { super(failure); }
}
const expoCode = (value: unknown) => typeof value === "string" && value
  ? `expo_${value.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 34)}`
  : null;
const httpCode = (status: number) => ({ 400: "expo_bad_request", 401: "expo_unauthorized", 403: "expo_forbidden", 404: "expo_not_found",
  413: "expo_too_large", 429: "expo_rate_limited" } as Record<number, string>)[status] ?? (status >= 500 ? "expo_server_error" : "expo_http_error");
/** A notification older than this is no longer news: it is dropped, never sent late. */
export const MAX_NOTIFICATION_AGE_MS = 6 * 3600_000;
async function expo(path: string, body: unknown) {
  const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => null) as { errors?: { code?: string }[] } | null;
  // Request-level refusals (credentials, project, size) come as `errors`, with or without an HTTP error status.
  if (!response.ok) throw new PushError(expoCode(json?.errors?.[0]?.code) ?? httpCode(response.status));
  if (Array.isArray(json?.errors) && json.errors.length) throw new PushError(expoCode(json.errors[0]?.code) ?? "expo_request_error");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo's reply shape differs per endpoint; read defensively below.
  return json as { data?: any };
}
/**
 * Notifications too old to be news are dropped together before the queue is claimed (20 at a time, oldest
 * first), so a backlog never delays a new one and never arrives at once on the phone.
 */
async function dropStaleDeliveries(db: ReturnType<typeof createServiceSupabase>) {
  const cutoff = new Date(Date.now() - MAX_NOTIFICATION_AGE_MS).toISOString();
  const { data: stale, error } = await db.from("mobile_notification_events").select("id,business_id").lt("created_at", cutoff)
    .order("created_at", { ascending: false }).limit(500);
  if (error || !stale?.length) return;
  const { data: dropped } = await db.from("mobile_notification_deliveries").update({ status: "failed" })
    .in("event_id", stale.map(e => e.id)).in("status", ["pending", "sending", "receipt"]).select("id,event_id");
  const business = new Map(stale.map(e => [e.id, e.business_id as string]));
  await Promise.all((dropped ?? []).map(d => recordSystem("system.mobile_push", "expired", { businessId: business.get(d.event_id) ?? null, ref: d.id })));
}
/** At-least-once delivery; notification IDs allow client deduplication. Never carries approval credentials. */
export async function deliverMobileNotifications() {
  const db = createServiceSupabase();
  await dropStaleDeliveries(db);
  const { data, error } = await db.rpc("claim_mobile_deliveries");
  if (error) throw Error("Notification queue unavailable");
  await Promise.all(
    ((data ?? []) as Delivery[]).map(async (delivery) => {
      let businessId: string | null = null;
      try {
        const { data: event } = await db
          .from("mobile_notification_events")
          .select("*")
          .eq("id", delivery.event_id)
          .single();
        const { data: device } = await db
          .from("mobile_devices")
          .select("user_id")
          .eq("token", delivery.token)
          .maybeSingle();
        const { data: business } = event
          ? await db
              .from("businesses")
              .select("slug")
              .eq("id", event.business_id)
              .maybeSingle()
          : { data: null };
        businessId = event?.business_id ?? null;
        const access =
          event && business && device?.user_id === event.user_id
            ? await requireBusinessAccess(event.user_id, business.slug)
            : null;
        const { data: conversation } = event
          ? await db
              .from("assistant_conversations")
              .select("id")
              .eq("id", event.conversation_id)
              .eq("owner_user_id", event.user_id)
              .is("deleted_at", null)
              .maybeSingle()
          : { data: null };
        // Old notifications (a queue that could not send for days) are dropped instead of arriving all at once.
        if (event && Date.now() - Date.parse(event.created_at) > MAX_NOTIFICATION_AGE_MS) {
          await db.from("mobile_notification_deliveries").update({ status: "failed" }).eq("id", delivery.id);
          await recordSystem("system.mobile_push", "expired", { businessId, ref: delivery.id });
          return;
        }
        if (!access || !conversation) {
          await db
            .from("mobile_notification_deliveries")
            .update({ status: "failed" })
            .eq("id", delivery.id);
          return;
        }
        let reply: ExpoReply | undefined;
        if (delivery.receipt_id) {
          const receipts = await expo("getReceipts", {
            ids: [delivery.receipt_id],
          });
          reply = receipts.data?.[delivery.receipt_id];
          if (!reply) {
            await db
              .from("mobile_notification_deliveries")
              .update({
                status: delivery.attempts >= 8 ? "failed" : "receipt",
                next_attempt: new Date(Date.now() + 15 * 60000).toISOString(),
              })
              .eq("id", delivery.id);
            return;
          }
        } else {
          const response = await expo("send", [
            {
              to: delivery.token,
              title: "Agjenti",
              body:
                event.kind === "backend_outcome"
                  ? "Veprimi yt ka një rezultat të konfirmuar."
                  : event.kind === "interrupted"
                    ? "Një kërkesë ka nevojë për kontroll."
                    : event.kind === "notice"
                      ? "Njoftim për mesazhet e paketës."
                      : "Asistenti ka një përgjigje për ty.",
              sound: "default",
              channelId: "assistant",
              data: {
                eventId: event.id,
                businessId: event.business_id,
                conversationId: event.conversation_id,
              },
            },
          ]);
          reply = response.data?.[0];
        }
        if (reply?.details?.error === "DeviceNotRegistered") {
          await db.from("mobile_devices").delete().eq("token", delivery.token);
          return;
        }
        if (reply?.status !== "ok") throw new PushError(expoCode(reply?.details?.error) ?? (reply ? "expo_ticket_error" : "expo_no_ticket"));
        if (!delivery.receipt_id && !reply.id) throw new PushError("expo_no_ticket_id");
        await db
          .from("mobile_notification_deliveries")
          .update({
            status: delivery.receipt_id ? "sent" : "receipt",
            receipt_id: delivery.receipt_id || reply.id,
            next_attempt: new Date(Date.now() + 15 * 60000).toISOString(),
          })
          .eq("id", delivery.id);
        if (delivery.receipt_id) await recordSystem("system.mobile_push", "delivered", { businessId, ref: delivery.id });
      } catch (error) {
        await recordSystem("system.mobile_push", "step_failed", { businessId, ref: delivery.id, reason: stepFailure("system.mobile_push", delivery.receipt_id ? "receipt" : "send", error, delivery.id) });
        await db
          .from("mobile_notification_deliveries")
          .update({
            status:
              delivery.attempts >= 8
                ? "failed"
                : delivery.receipt_id
                  ? "receipt"
                  : "pending",
            next_attempt: new Date(
              Date.now() + Math.min(3600, 30 * 2 ** delivery.attempts) * 1000,
            ).toISOString(),
          })
          .eq("id", delivery.id);
      }
    }),
  );
}
