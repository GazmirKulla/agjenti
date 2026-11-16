import type { SupabaseClient } from "@supabase/supabase-js";

/** What a customer message replies to, as the channel reported it. Display only. */
export type ReplyTarget = { mid: string } | { story: { id: string | null; url: string | null } };
/** The quoted message, resolved inside the same conversation; null fields when it is gone. */
export type ReplyQuote = { messageId: string | null; body: string | null; direction: "inbound" | "outbound" | null; deleted: boolean };

const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 1024 ? v : null;
const https = (v: unknown) => typeof v === "string" && v.length <= 2048 && v.startsWith("https://") ? v : null;
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Reads the provider's `reply_to` (Instagram) from the inbound context; null when absent or malformed. */
export function replyTargetFrom(context: Record<string, unknown> | null | undefined): ReplyTarget | null {
  const reply = record(context?.replyTo);
  if (!reply) return null;
  const story = record(reply.story);
  if (story) {
    const target = { id: id(story.id), url: https(story.url) };
    return target.id || target.url ? { story: target } : null;
  }
  const mid = id(reply.mid);
  return mid ? { mid } : null;
}

type Row = { id: string; reply_to?: unknown };

/**
 * Resolves quoted messages for a page of the thread. Our own replies may be split into parts,
 * each with its own provider id, so a part id resolves to its message. Never leaves the conversation.
 */
export async function loadReplyQuotes(db: SupabaseClient, businessId: string, conversationId: string, rows: Row[]): Promise<Map<string, ReplyQuote>> {
  const quotes = new Map<string, ReplyQuote>();
  const wanted = new Map<string, string[]>();
  for (const row of rows) {
    const mid = id(record(row.reply_to)?.mid);
    if (mid) wanted.set(mid, [...(wanted.get(mid) ?? []), row.id]);
  }
  if (!wanted.size) return quotes;
  const mids = [...wanted.keys()].slice(0, 200);
  const columns = "id,body,direction,customer_deleted_at,external_message_id";
  type Quoted = { id: string; body: string | null; direction: string; customer_deleted_at: string | null; external_message_id: string | null };
  const [direct, parts] = await Promise.all([
    db.from("messages").select(columns).eq("business_id", businessId).eq("conversation_id", conversationId).in("external_message_id", mids),
    db.from("message_transport_parts").select("external_message_id,message_id").eq("business_id", businessId).in("external_message_id", mids),
  ]);
  const byMid = new Map<string, Quoted>();
  for (const m of (direct.error ? [] : direct.data ?? []) as Quoted[]) if (m.external_message_id) byMid.set(m.external_message_id, m);
  const partRows = (parts.error ? [] : parts.data ?? []) as { external_message_id: string; message_id: string | null }[];
  const partIds = [...new Set(partRows.map(p => p.message_id).filter((v): v is string => Boolean(v)))];
  if (partIds.length) {
    const viaParts = await db.from("messages").select(columns).eq("business_id", businessId).eq("conversation_id", conversationId).in("id", partIds);
    const byId = new Map(((viaParts.error ? [] : viaParts.data ?? []) as Quoted[]).map(m => [m.id, m]));
    for (const p of partRows) { const m = p.message_id ? byId.get(p.message_id) : undefined; if (m && !byMid.has(p.external_message_id)) byMid.set(p.external_message_id, m); }
  }
  for (const [mid, replies] of wanted) {
    const m = byMid.get(mid);
    const quote: ReplyQuote = m
      ? { messageId: m.id, body: m.customer_deleted_at ? null : m.body?.slice(0, 280) ?? null, direction: m.direction === "outbound" ? "outbound" : "inbound", deleted: Boolean(m.customer_deleted_at) }
      : { messageId: null, body: null, direction: null, deleted: false };
    for (const reply of replies) quotes.set(reply, quote);
  }
  return quotes;
}
