import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationDisplayName } from "./ensure-customer";

/** Shared by the web Inbox and the native app, so both read the same rows and tenant filters. */
export class InboxReadError extends Error {
  constructor(readonly code: "list_unavailable" | "thread_unavailable") {
    super(code);
  }
}

type CustomerJoin = {
  business_id: string;
  display_name: string | null;
  username: string | null;
  phone?: string | null;
  created_at?: string;
} | null;

export type InboxRow = {
  id: string;
  channel: string;
  status: string;
  name: string;
  preview: string | null;
  unread: number;
  updatedAt: string | null;
};

export async function loadInboxRows(db: SupabaseClient, businessId: string): Promise<InboxRow[]> {
  const { data, error } = await db
    .from("conversations")
    .select(
      "id,channel,status,last_message_preview,last_message_at,unread_count,participant_display_name,participant_username,customers(business_id,display_name,username)",
    )
    .eq("business_id", businessId)
    .eq("customers.business_id", businessId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw new InboxReadError("list_unavailable");
  return (data ?? []).map((row) => {
    const joined = row.customers as unknown as CustomerJoin;
    return {
      id: row.id,
      channel: row.channel,
      status: row.status,
      name: conversationDisplayName({
        participant_display_name: row.participant_display_name,
        participant_username: row.participant_username,
        customers: joined?.business_id === businessId ? joined : null,
      }),
      preview: row.last_message_preview,
      unread: Number.isSafeInteger(row.unread_count) && row.unread_count > 0 ? row.unread_count : 0,
      updatedAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
    };
  });
}

export type ThreadConversation = {
  id: string;
  channel: string;
  status: string;
  last_inbound_at: string | null;
  customer_id: string | null;
  participant_display_name: string | null;
  participant_username: string | null;
  /** Null unless the joined customer belongs to this business. */
  customer: CustomerJoin;
  name: string;
  handle: string;
};

/** Null when the conversation is not in this business. */
export async function loadThreadConversation(db: SupabaseClient, businessId: string, conversationId: string): Promise<ThreadConversation | null> {
  const { data, error } = await db
    .from("conversations")
    .select(
      "id,channel,status,last_inbound_at,customer_id,instagram_participant_id,participant_display_name,participant_username,customers(business_id,display_name,username,phone,created_at)",
    )
    .eq("business_id", businessId)
    .eq("customers.business_id", businessId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new InboxReadError("thread_unavailable");
  if (!data) return null;
  // The service-role client bypasses RLS; a parent tenant filter alone does not
  // authorize its FK target. Keep unmatched conversations, never foreign PII.
  const joined = data.customers as unknown as CustomerJoin;
  const customer = joined?.business_id === businessId ? joined : null;
  const username = customer?.username || data.participant_username;
  return {
    id: data.id,
    channel: data.channel,
    status: data.status,
    last_inbound_at: data.last_inbound_at,
    customer_id: data.customer_id,
    participant_display_name: data.participant_display_name,
    participant_username: data.participant_username,
    customer,
    name: conversationDisplayName({
      participant_display_name: data.participant_display_name,
      participant_username: data.participant_username,
      customers: customer,
    }),
    handle: username ? `@${username}` : data.channel === "whatsapp" ? "WhatsApp" : "Instagram",
  };
}

export const threadMessageColumns =
  "id,direction,source,body,media,created_at,delivery_status,delivery_error,external_message_id,transport_request_id,message_transport_parts(id,part_index,part_count,body,status)";

/** The latest 200 messages, oldest first. */
export async function loadThreadMessages(db: SupabaseClient, businessId: string, conversationId: string) {
  const { data, error } = await db
    .from("messages")
    .select(threadMessageColumns)
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new InboxReadError("thread_unavailable");
  return (data ?? []).reverse();
}

export type CustomerOrder = {
  id: string;
  status: string;
  total_amount: number | null;
  currency: string | null;
  created_at: string;
};

/** The customer's five latest orders in this business; none for an unlinked conversation. */
export async function loadCustomerOrders(db: SupabaseClient, businessId: string, customerId: string | null): Promise<CustomerOrder[]> {
  if (!customerId) return [];
  const { data, error } = await db
    .from("orders")
    .select("id,status,total_amount,currency,created_at")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new InboxReadError("thread_unavailable");
  return data ?? [];
}
