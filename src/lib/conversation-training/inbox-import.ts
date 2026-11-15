import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transcript } from "@/lib/conversation-learning/transcripts";

/** How many Instagram conversations one import reads from Meta; the owner chooses. */
export const HISTORY_LIMITS = [50, 100, 200] as const;
export type HistoryLimit = (typeof HISTORY_LIMITS)[number];
export const DEFAULT_HISTORY_LIMIT: HistoryLimit = 200;

export type HistoryOptions = { limit: HistoryLimit; addToInbox: boolean };

/** The owner's choice, validated: only the offered counts, and adding is off unless asked. */
export function parseHistoryOptions(input: { limit?: unknown; addToInbox?: unknown }): HistoryOptions | null {
  const limit = input.limit === undefined ? DEFAULT_HISTORY_LIMIT : input.limit;
  if (!HISTORY_LIMITS.includes(limit as HistoryLimit)) return null;
  if (input.addToInbox !== undefined && typeof input.addToInbox !== "boolean") return null;
  return { limit: limit as HistoryLimit, addToInbox: input.addToInbox === true };
}

const CHUNK = 200;
const chunks = <T,>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

type Row = {
  business_id: string; conversation_id: string; instagram_connection_id: string;
  direction: "inbound" | "outbound"; source: "customer" | "staff"; sent_via: "instagram_app" | null;
  body: string; external_message_id: string; delivery_status: "delivered" | "sent"; created_at: string;
};

/**
 * Writes Instagram history into the business's Conversations as ordinary messages:
 * the customer's lines inbound, the business's lines as staff replies sent from the
 * Instagram app. A message already stored (by the webhook or an earlier import) or
 * sent by Agjenti is skipped by its Instagram id, so importing again adds nothing twice.
 *
 * A customer with a conversation here gets the missing messages in their latest one,
 * whose status and auto-reply are left as they are. A customer without one gets a
 * completed conversation: their next message opens a new one, as for any finished
 * thread, so imported history never makes the agent reply or take over.
 * Nothing is sent to customers.
 */
export async function addHistoryToInbox(db: SupabaseClient, params: { businessId: string; connectionId: string; threads: Transcript[] }) {
  const { businessId, connectionId } = params;
  const threads = params.threads.filter((t) => t.channel === "instagram" && t.customer?.id);
  const ids = threads.flatMap((t) => t.lines.map((l) => l.id).filter((id): id is string => !!id));
  if (!ids.length) return { conversations: 0, created: 0, messages: 0 };

  const known = new Set<string>();
  for (const part of chunks(ids)) {
    const [stored, ours] = await Promise.all([
      db.from("messages").select("external_message_id").eq("business_id", businessId).eq("instagram_connection_id", connectionId).in("external_message_id", part),
      db.from("message_transport_parts").select("external_message_id").eq("business_id", businessId).eq("connection_id", connectionId).in("external_message_id", part),
    ]);
    if (stored.error || ours.error) throw new Error("inbox_lookup_failed");
    for (const row of [...(stored.data ?? []), ...(ours.data ?? [])]) if (row.external_message_id) known.add(row.external_message_id as string);
  }

  const pending = threads.map((t) => ({
    customer: t.customer!,
    // Agent lines are Agjenti's own sends; when not found above they are not written as staff.
    lines: t.lines.filter((l) => l.id && !known.has(l.id) && l.speaker !== "agjenti" && l.text.trim()).sort((a, b) => a.at.localeCompare(b.at)),
  })).filter((t) => t.lines.length);
  if (!pending.length) return { conversations: 0, created: 0, messages: 0 };

  const latest = new Map<string, { id: string; last: string | null }>();
  for (const part of chunks(pending.map((t) => t.customer.id))) {
    const { data, error } = await db.from("conversations").select("id,instagram_participant_id,last_message_at,created_at")
      .eq("business_id", businessId).eq("instagram_connection_id", connectionId).in("instagram_participant_id", part)
      .order("created_at", { ascending: false });
    if (error) throw new Error("inbox_lookup_failed");
    for (const row of data ?? []) {
      const participant = row.instagram_participant_id as string;
      if (!latest.has(participant)) latest.set(participant, { id: row.id as string, last: row.last_message_at as string | null });
    }
  }

  const fresh = pending.filter((t) => !latest.has(t.customer.id));
  for (const part of chunks(fresh)) {
    const { data, error } = await db.from("conversations").insert(part.map((t) => {
      const last = t.lines[t.lines.length - 1];
      const inbound = t.lines.filter((l) => l.speaker === "klienti").at(-1);
      return {
        business_id: businessId, customer_id: null, channel: "instagram",
        instagram_participant_id: t.customer.id, instagram_connection_id: connectionId,
        participant_username: t.customer.username ?? null,
        status: "completed", auto_reply: null, unread_count: 0,
        last_message_at: last.at, last_inbound_at: inbound?.at ?? null, last_message_preview: last.text.slice(0, 140),
      };
    })).select("id,instagram_participant_id");
    if (error) throw new Error("inbox_conversation_failed");
    for (const row of data ?? []) latest.set(row.instagram_participant_id as string, { id: row.id as string, last: null });
  }

  const rows: Row[] = pending.flatMap((t) => {
    const conversation = latest.get(t.customer.id);
    if (!conversation) return [];
    return t.lines.map((l) => {
      const customer = l.speaker === "klienti";
      return {
        business_id: businessId, conversation_id: conversation.id, instagram_connection_id: connectionId,
        direction: customer ? "inbound" : "outbound", source: customer ? "customer" : "staff",
        sent_via: customer ? null : "instagram_app", body: l.text, external_message_id: l.id!,
        delivery_status: customer ? "delivered" : "sent", created_at: l.at,
      } satisfies Row;
    });
  });
  let messages = 0;
  for (const part of chunks(rows)) messages += await insertMessages(db, part);

  // Existing conversations move up only when the history is newer than what they show.
  for (const t of pending) {
    const conversation = latest.get(t.customer.id);
    const last = t.lines[t.lines.length - 1];
    if (!conversation?.last || last.at <= conversation.last) continue;
    await db.from("conversations").update({ last_message_at: last.at, last_message_preview: last.text.slice(0, 140) })
      .eq("id", conversation.id).eq("business_id", businessId).lte("last_message_at", last.at);
  }
  return { conversations: pending.length, created: fresh.length, messages };
}

/** One batch; when the webhook stored one of them meanwhile, row by row, skipping duplicates. */
async function insertMessages(db: SupabaseClient, rows: Row[]) {
  const { error } = await db.from("messages").insert(rows);
  if (!error) return rows.length;
  if (error.code !== "23505") throw new Error("inbox_message_failed");
  let added = 0;
  for (const row of rows) {
    const one = await db.from("messages").insert(row);
    if (!one.error) added++;
    else if (one.error.code !== "23505") throw new Error("inbox_message_failed");
  }
  return added;
}
