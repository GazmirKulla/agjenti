import { createServiceSupabase } from "@/lib/supabase/service";
import { channelAdapter, type MessagingChannel } from "./channel";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown) => Array.isArray(v) ? v.map(row) : [];
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024;
const MAX_TEXT = 4096;

/** The customer unsent (`deleted`) or edited (`text`) one of their own messages on the channel. */
export type CustomerMessageChange = {
  channel: MessagingChannel; accountId: string; participantId: string; messageId: string; occurredAt: string;
} & ({ deleted: true; text: null } | { deleted: false; text: string });

/**
 * Exact sender/recipient binding: only customer → business events. Business unsends (echoes)
 * are not customer changes. These events never enter the agent queue.
 */
export function parseProviderMessageChanges(payload: unknown, now = Date.now()): CustomerMessageChange[] {
  const root = row(payload), result: CustomerMessageChange[] = [];
  if (root.object !== "instagram") return result;
  for (const entry of rows(root.entry)) {
    const account = entry.id;
    if (!validId(account)) continue;
    const events = [...rows(entry.messaging), ...rows(entry.changes).filter(c => ["messages", "message_edit"].includes(String(c.field))).map(c => row(c.value))];
    for (const event of events) {
      const person = row(event.sender).id, time = Number(event.timestamp);
      if (row(event.recipient).id !== account || !validId(person) || person === account
        || !Number.isFinite(time) || time > now + 300000 || time < now - 7 * 86400000) continue;
      const base = { channel: "instagram" as const, accountId: account, participantId: person, occurredAt: new Date(time).toISOString() };
      const message = row(event.message);
      if (message.is_deleted === true && message.is_echo !== true && validId(message.mid)) {
        result.push({ ...base, messageId: message.mid, deleted: true, text: null });
        continue;
      }
      const edit = row(event.message_edit);
      if (validId(edit.mid) && typeof edit.text === "string" && edit.text.length <= MAX_TEXT) {
        result.push({ ...base, messageId: edit.mid, deleted: false, text: edit.text });
      }
    }
  }
  return result;
}

/** Call only after raw-body signature verification. Account identity resolves the tenant. */
export async function persistProviderMessageChanges(changes: CustomerMessageChange[]) {
  if (!changes.length) return;
  const db = createServiceSupabase();
  for (const change of changes) {
    const adapter = channelAdapter(change.channel);
    const { data: connection, error } = await db.from(adapter.table).select("id").eq(adapter.account, change.accountId).eq("status", "connected").maybeSingle();
    if (error) throw new Error("Message change connection unavailable");
    if (!connection) continue;
    const result = await db.rpc("record_customer_message_change", {
      p_connection: connection.id, p_participant: change.participantId, p_external: change.messageId,
      p_deleted: change.deleted, p_text: change.text, p_occurred: change.occurredAt,
    });
    if (result.error) throw new Error("Message change persistence failed");
  }
}
