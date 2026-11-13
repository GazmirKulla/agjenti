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

/**
 * A page cursor: the sort value and id of the last row the reader has.
 * Opaque to clients ("<iso time or empty>|<uuid>"); anything malformed means the first page.
 */
export type PageCursor = { at: string | null; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
export function parseCursor(value: string | null | undefined): PageCursor | null {
  const [at, id] = (value ?? "").split("|");
  if (!id || !UUID.test(id) || (at && !ISO.test(at))) return null;
  return { at: at || null, id };
}
export const cursorOf = (at: string | null, id: string) => `${at ?? ""}|${id}`;
export const INBOX_PAGE = 30;
export const THREAD_PAGE = 50;
const pageSize = (value: number | undefined, fallback: number, max: number) =>
  Number.isInteger(value) && value! > 0 ? Math.min(value!, max) : fallback;

/** One page of the Inbox, newest first; `next` reads the page after it. */
export async function loadInboxPage(
  db: SupabaseClient,
  businessId: string,
  options: { before?: PageCursor | null; limit?: number } = {},
): Promise<{ rows: InboxRow[]; next: string | null }> {
  const limit = pageSize(options.limit, INBOX_PAGE, 100);
  let read = db
    .from("conversations")
    .select(
      "id,channel,status,last_message_preview,last_message_at,unread_count,participant_display_name,participant_username,customers(business_id,display_name,username)",
    )
    .eq("business_id", businessId)
    .eq("customers.business_id", businessId);
  const before = options.before;
  if (before)
    read = before.at
      ? read.or(`last_message_at.lt."${before.at}",and(last_message_at.eq."${before.at}",id.lt.${before.id}),last_message_at.is.null`)
      : read.is("last_message_at", null).lt("id", before.id);
  const { data, error } = await read
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new InboxReadError("list_unavailable");
  const page = (data ?? []).slice(0, limit);
  const last = page.at(-1);
  const rows = page.map((row) => {
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
  return { rows, next: (data ?? []).length > limit && last ? cursorOf(last.last_message_at ?? null, last.id) : null };
}

/** The first page of the Inbox. */
export async function loadInboxRows(db: SupabaseClient, businessId: string, limit = INBOX_PAGE): Promise<InboxRow[]> {
  return (await loadInboxPage(db, businessId, { limit })).rows;
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
  "id,direction,source,sent_via,body,media,created_at,delivery_status,delivery_error,external_message_id,transport_request_id,message_transport_parts(id,part_index,part_count,body,status)";

/** A page of messages, oldest first: the latest ones, or those older than `before`.
 * `older` reads the page before it; null when there is nothing older. */
export async function loadThreadPage(
  db: SupabaseClient,
  businessId: string,
  conversationId: string,
  options: { before?: PageCursor | null; limit?: number } = {},
) {
  const limit = pageSize(options.limit, THREAD_PAGE, 200);
  let read = db
    .from("messages")
    .select(threadMessageColumns)
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId);
  const before = options.before;
  if (before?.at) read = read.or(`created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.id})`);
  const { data, error } = await read
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw new InboxReadError("thread_unavailable");
  const page = (data ?? []).slice(0, limit);
  const oldest = page.at(-1);
  return {
    messages: page.reverse(),
    older: (data ?? []).length > limit && oldest ? cursorOf(oldest.created_at, oldest.id) : null,
  };
}

/** The latest messages, oldest first. */
export async function loadThreadMessages(db: SupabaseClient, businessId: string, conversationId: string, limit = THREAD_PAGE) {
  return (await loadThreadPage(db, businessId, conversationId, { limit })).messages;
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
