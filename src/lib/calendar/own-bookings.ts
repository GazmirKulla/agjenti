import { channelAdapter } from "@/lib/conversations/channel";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { OrderCustomerIdentity } from "@/lib/orders/own-orders";
import { zonedParts } from "./model";

export type OwnBooking = { id: string; serviceId: string; serviceName: string; date: string; time: string; startsAt: string; status: "pending" | "confirmed" | "cancelled"; revision: number; changeable: boolean };

/**
 * Read only: the customer's own upcoming bookings, found by the verified channel identity (the same
 * participant on the same connection), never by an ID or a name the model or the customer supplied.
 * Null when the identity does not match this conversation.
 */
export async function ownBookings(businessId: string, identity: OrderCustomerIdentity, now = Date.now()): Promise<OwnBooking[] | null> {
  const db = createServiceSupabase();
  const adapter = channelAdapter(identity.channel);
  const { data: conversation, error } = await db.from("conversations").select("id").eq("business_id", businessId).eq("id", identity.conversationId)
    .eq(adapter.participant, identity.instagramParticipantId).eq(adapter.connection, identity.instagramConnectionId).maybeSingle();
  if (error) throw new Error("booking_status_unavailable");
  if (!conversation) return null;
  const [conversations, settings] = await Promise.all([
    db.from("conversations").select("id").eq("business_id", businessId)
      .eq(adapter.participant, identity.instagramParticipantId).eq(adapter.connection, identity.instagramConnectionId)
      .order("created_at", { ascending: false }).limit(100),
    db.from("business_calendar_settings").select("timezone").eq("business_id", businessId).maybeSingle(),
  ]);
  if (conversations.error || settings.error) throw new Error("booking_status_unavailable");
  const ids = [...new Set([conversation.id, ...(conversations.data ?? []).map(row => row.id)])];
  const { data, error: bookingsError } = await db.from("bookings").select("id,service_id,service_name,starts_at,status,revision")
    .eq("business_id", businessId).in("conversation_id", ids).gt("starts_at", new Date(now).toISOString()).order("starts_at").limit(6);
  if (bookingsError) throw new Error("booking_status_unavailable");
  const timezone = settings.data?.timezone ?? "Europe/Tirane";
  return (data ?? []).map(row => {
    const local = zonedParts(row.starts_at, timezone);
    return { id: row.id, serviceId: row.service_id, serviceName: row.service_name, date: local.date, time: local.time, startsAt: row.starts_at,
      status: row.status, revision: row.revision, changeable: row.status !== "cancelled" };
  });
}
