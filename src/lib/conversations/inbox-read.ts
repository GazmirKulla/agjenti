import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationDisplayName } from "./ensure-customer";
import { participantAvatarUrl } from "./participant-avatar";
import { loadReplyQuotes } from "./reply-target";
import { ORDER_ITEMS_SELECT, orderItemSummary, type OrderItemSummary } from "@/lib/orders/item-summary";
import { followUpHours, type LeadFilter } from "@/lib/leads/model";

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
  updated_at?: string;
} | null;

/** What the business already has from this conversation, read from its own rows. */
export type InboxSignals = {
  /** The customer sent a phone number or one was collected/linked (a format check). */
  phone: boolean;
  /** The customer sent an email address or one was collected (a format check). */
  email: boolean;
  /** Orders of this conversation or its linked customer, drafts and failures excluded. */
  orders: number;
  /** The conversation's lead status (new, contacted, won, lost); null when it is not a lead. */
  lead: "new" | "contacted" | "won" | "lost" | null;
  /** Linked to a (non-archived) customer record of this business. */
  customer: boolean;
};

export type InboxRow = {
  id: string;
  channel: string;
  status: string;
  name: string;
  preview: string | null;
  /** 0 once the business replied; kept for app versions that read only this. */
  unread: number;
  /** The customer's latest message has no delivered reply after it; null when unknown. */
  awaitingReply: boolean | null;
  /** Null when the signals could not be read; the row still shows. */
  signals: InboxSignals | null;
  updatedAt: string | null;
  /** Short-lived link to the customer's stored profile photo; null shows initials. */
  avatarUrl: string | null;
};

type SignalRow = {
  conversation_id: string;
  last_customer_at: string | null;
  last_reply_at: string | null;
  has_phone: boolean | null;
  has_email: boolean | null;
  order_count: number | null;
  lead_status: string | null;
  customer_linked: boolean | null;
};
const LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;

/** Reply state and indicators for one page of conversations, scoped to the business. */
async function loadInboxSignals(db: SupabaseClient, businessId: string, ids: string[]) {
  const signals = new Map<string, { awaitingReply: boolean; signals: InboxSignals }>();
  if (!ids.length) return signals;
  const { data, error } = await db.rpc("inbox_row_signals", { p_business: businessId, p_conversations: ids });
  if (error || !Array.isArray(data)) {
    // The list still renders; rows show no reply state or indicators instead of a guess.
    console.warn("[inbox] signals unavailable", error?.message ?? "no data");
    return signals;
  }
  const wanted = new Set(ids);
  for (const row of data as SignalRow[]) {
    if (!wanted.has(row.conversation_id)) continue;
    const customerAt = row.last_customer_at ? Date.parse(row.last_customer_at) : NaN;
    const replyAt = row.last_reply_at ? Date.parse(row.last_reply_at) : NaN;
    signals.set(row.conversation_id, {
      awaitingReply: Number.isFinite(customerAt) && !(Number.isFinite(replyAt) && replyAt >= customerAt),
      signals: {
        phone: row.has_phone === true,
        email: row.has_email === true,
        orders: Number.isSafeInteger(row.order_count) && row.order_count! > 0 ? row.order_count! : 0,
        lead: LEAD_STATUSES.find((status) => status === row.lead_status) ?? null,
        customer: row.customer_linked === true,
      },
    });
  }
  return signals;
}

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
/** A search text safe inside a PostgREST filter: letters, digits, spaces and + - . @ _ ' only, at most 60 characters. */
export function inboxQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFC").replace(/[^\p{L}\p{N} +\-.@_']/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return text.length >= 2 ? text : null;
}

export async function loadInboxPage(
  db: SupabaseClient,
  businessId: string,
  options: { before?: PageCursor | null; limit?: number; query?: string | null; lead?: LeadFilter | null } = {},
): Promise<{ rows: InboxRow[]; next: string | null }> {
  const limit = pageSize(options.limit, INBOX_PAGE, 100);
  // Search: the name or username on the channel, the last message, or the saved customer's name, username or phone.
  const query = inboxQuery(options.query);
  let customerIds: string[] = [];
  if (query) {
    const like = `*${query}*`;
    const { data: customers, error: customerError } = await db.from("customers").select("id").eq("business_id", businessId)
      .or(`display_name.ilike.${like},username.ilike.${like},phone.ilike.${like}`).limit(50);
    if (customerError) throw new InboxReadError("list_unavailable");
    customerIds = (customers ?? []).map((c) => c.id as string);
  }
  let read = db
    .from("conversations")
    .select(
      "id,channel,status,last_message_preview,last_message_at,unread_count,participant_display_name,participant_username,participant_avatar_path,participant_avatar_checked_at,customers(business_id,display_name,username)",
    )
    .eq("business_id", businessId)
    .eq("customers.business_id", businessId);
  if (query) {
    const like = `*${query}*`;
    read = read.or([`participant_display_name.ilike.${like}`, `participant_username.ilike.${like}`, `last_message_preview.ilike.${like}`,
      ...(customerIds.length ? [`customer_id.in.(${customerIds.join(",")})`] : [])].join(","));
  }
  // Leads are a state of the conversation: the interested ones, those still unanswered past the follow-up time, won or lost.
  if (options.lead === "open") read = read.in("lead_status", ["new", "contacted"]);
  else if (options.lead === "won" || options.lead === "lost") read = read.eq("lead_status", options.lead);
  else if (options.lead === "waiting") {
    const { data: business } = await db.from("businesses").select("lead_settings").eq("id", businessId).maybeSingle();
    read = read.eq("lead_status", "new").lt("lead_at", new Date(Date.now() - followUpHours(business?.lead_settings) * 3_600_000).toISOString());
  }
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
  const signals = await loadInboxSignals(db, businessId, page.map((row) => row.id));
  const rows = page.map((row): InboxRow => {
    const joined = row.customers as unknown as CustomerJoin;
    const known = signals.get(row.id);
    const unread = Number.isSafeInteger(row.unread_count) && row.unread_count > 0 ? row.unread_count : 0;
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
      unread: known?.awaitingReply === false ? 0 : unread,
      awaitingReply: known ? known.awaitingReply : null,
      signals: known?.signals ?? null,
      updatedAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
      avatarUrl: participantAvatarUrl(businessId, row.id, row.participant_avatar_path, row.participant_avatar_checked_at),
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
  avatarUrl: string | null;
};

/** Null when the conversation is not in this business. */
export async function loadThreadConversation(db: SupabaseClient, businessId: string, conversationId: string): Promise<ThreadConversation | null> {
  const { data, error } = await db
    .from("conversations")
    .select(
      "id,channel,status,last_inbound_at,customer_id,instagram_participant_id,participant_display_name,participant_username,participant_avatar_path,participant_avatar_checked_at,customers(business_id,display_name,username,phone,created_at,updated_at)",
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
    avatarUrl: participantAvatarUrl(businessId, data.id, data.participant_avatar_path, data.participant_avatar_checked_at),
  };
}

export const threadMessageColumns =
  "id,direction,source,sent_via,campaign_id,campaign_name,body,media,created_at,customer_deleted_at,customer_edited_at,reply_to,delivery_status,delivery_error,external_message_id,transport_request_id,message_transport_parts(id,part_index,part_count,body,status)";

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
  // A quote that cannot be read is left out; the reply itself still shows.
  const quotes = await loadReplyQuotes(db, businessId, conversationId, page).catch(() => new Map());
  return {
    messages: page.reverse().map((m) => ({ ...m, reply_quote: quotes.get(m.id) ?? null })),
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
  items: OrderItemSummary[];
};

/** The customer's five latest orders in this business; none for an unlinked conversation. */
export async function loadCustomerOrders(db: SupabaseClient, businessId: string, customerId: string | null): Promise<CustomerOrder[]> {
  if (!customerId) return [];
  const { data, error } = await db
    .from("orders")
    .select(`id,status,total_amount,currency,created_at,${ORDER_ITEMS_SELECT}`)
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new InboxReadError("thread_unavailable");
  return (data ?? []).map(({ order_items, ...order }) => ({ ...order, items: orderItemSummary(order_items) }));
}
