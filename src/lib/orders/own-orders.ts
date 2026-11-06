import { channelAdapter } from "@/lib/conversations/channel";
import { createServiceSupabase } from "@/lib/supabase/service";
export type OrderCustomerIdentity = {
  channel?: "instagram" | "whatsapp";
  conversationId: string;
  instagramParticipantId: string;
  instagramConnectionId: string;
};
type OrderSummary = { id: string; status: string; created_at: string };

/** Read only: the query never accepts a customer ID or order ID as an authorization boundary. */
export async function ownOrders(businessId: string, identity: OrderCustomerIdentity): Promise<OrderSummary[] | null> {
  const db = createServiceSupabase();
  const adapter = channelAdapter(identity.channel);
  const { data: conversation, error: identityError } = await db.from("conversations").select("id,customer_id")
    .eq("business_id", businessId).eq("id", identity.conversationId)
    .eq(adapter.participant, identity.instagramParticipantId).eq(adapter.connection, identity.instagramConnectionId).maybeSingle();
  if (identityError) throw new Error("order_status_unavailable");
  if (!conversation) return null;
  const [{ data: conversations, error: conversationsError }, { data: customer, error: customerError }] = await Promise.all([
    db.from("conversations").select("id").eq("business_id", businessId)
      .eq(adapter.participant, identity.instagramParticipantId).eq(adapter.connection, identity.instagramConnectionId)
      .order("created_at", { ascending: false }).limit(100),
    db.from("customers").select("id").eq("business_id", businessId).eq(identity.channel === "whatsapp" ? "whatsapp_user_id" : "instagram_user_id", identity.instagramParticipantId).maybeSingle(),
  ]);
  if (conversationsError || customerError) throw new Error("order_status_unavailable");
  const ids = [...new Set([conversation.id, ...(conversations ?? []).map(item => item.id)])];
  const scoped = db.from("orders").select("id,status,created_at").eq("business_id", businessId);
  const results = await Promise.all([
    scoped.in("conversation_id", ids).order("created_at", { ascending: false }).limit(6),
    customer ? db.from("orders").select("id,status,created_at").eq("business_id", businessId).eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [], error: null }),
  ]);
  if (results.some(result => result.error)) throw new Error("order_status_unavailable");
  const orders = new Map<string, OrderSummary>();
  for (const result of results) for (const order of result.data ?? []) orders.set(order.id, order);
  return [...orders.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
}

