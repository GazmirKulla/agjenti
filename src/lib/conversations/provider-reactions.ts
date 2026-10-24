import { createServiceSupabase } from "@/lib/supabase/service";
import { channelAdapter, type MessagingChannel } from "./channel";
import { graphVersion } from "@/lib/instagram/oauth";
import { whatsappGraphVersion } from "@/lib/whatsapp/api";
import { assertBusinessEffectAllowed, isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { reactionCapabilities } from "./reactions";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown) => Array.isArray(v) ? v.map(row) : [];
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
export function validReactionEmoji(v: unknown): v is string {
  return typeof v === "string" && (v === "" || v.length <= 32 && [...segmenter.segment(v)].length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(v));
}
export type IncomingReaction = { channel: MessagingChannel; accountId: string; participantId: string; messageId: string; emoji: string; occurredAt: string };
/** Exact sender/recipient binding. Business echoes are not customer authors. */
export function parseProviderReactions(payload: unknown, now = Date.now()): IncomingReaction[] {
  const root = row(payload), result: IncomingReaction[] = [];
  function add(channel: MessagingChannel, account: unknown, person: unknown, message: unknown, emoji: unknown, time: number) {
    if (!validId(account) || !validId(person) || person === account || !validId(message) || !validReactionEmoji(emoji)
      || !Number.isFinite(time) || time > now + 300000 || time < now - 7 * 86400000) return;
    result.push({ channel, accountId: account, participantId: person, messageId: message, emoji, occurredAt: new Date(time).toISOString() });
  }
  for (const entry of rows(root.entry)) {
    if (root.object === "instagram") {
      const events = [...rows(entry.messaging), ...rows(entry.changes).filter(c => ["message_reactions", "messaging_reactions"].includes(String(c.field))).map(c => row(c.value))];
      for (const event of events) {
        if (row(event.recipient).id !== entry.id) continue;
        const reaction = row(event.reaction);
        if (!["react", "unreact"].includes(String(reaction.action))) continue;
        add("instagram", entry.id, row(event.sender).id, reaction.mid, reaction.action === "unreact" ? "" : reaction.emoji ?? (reaction.reaction === "love" ? "❤️" : undefined), Number(event.timestamp));
      }
    }
    if (root.object === "whatsapp_business_account") for (const change of rows(entry.changes)) {
      if (change.field !== "messages") continue;
      const value = row(change.value);
      for (const message of rows(value.messages)) {
        if (message.type !== "reaction" || !validId(message.id)) continue;
        const reaction = row(message.reaction);
        add("whatsapp", row(value.metadata).phone_number_id, message.from, reaction.message_id, reaction.emoji ?? "", Number(message.timestamp) * 1000);
      }
    }
  }
  return result;
}
export async function persistProviderReactions(events: IncomingReaction[]) {
  if (!events.length) return;
  const db = createServiceSupabase();
  for (const event of events) {
    const adapter = channelAdapter(event.channel);
    const { data: connection, error } = await db.from(adapter.table).select("id").eq(adapter.account, event.accountId).eq("status", "connected").maybeSingle();
    if (error) throw new Error("Reaction connection unavailable");
    if (!connection) continue;
    const result = await db.rpc("record_customer_reaction", { p_connection: connection.id, p_participant: event.participantId, p_external: event.messageId, p_emoji: event.emoji, p_occurred: event.occurredAt });
    if (result.error) throw new Error("Reaction persistence failed");
  }
}
export type ReactionResult = { status: "sent" | "failed" | "uncertain"; externalId: string | null; error: string | null };
export async function sendManualReaction(p: { channel: MessagingChannel; accountId: string; token: string; to: string; messageId: string; emoji: string }): Promise<ReactionResult> {
  assertBusinessEffectAllowed(`${p.channel}.reaction`);
  if (isIsolatedExecution()) refuseIsolatedEffect("customer.message", `${p.channel}.reaction`);
  const capabilities = reactionCapabilities(p.channel);
  if (!(p.emoji === "" ? capabilities.remove : (capabilities.emoji as readonly string[]).includes(p.emoji))) return { status: "failed", externalId: null, error: "Reaction nuk mbështetet." };
  const ig = p.channel === "instagram";
  const payload = ig ? { recipient: { id: p.to }, sender_action: p.emoji ? "react" : "unreact", payload: { message_id: p.messageId, ...(p.emoji ? { reaction: p.emoji === "❤️" ? "love" : p.emoji } : {}) } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: p.to, type: "reaction", reaction: { message_id: p.messageId, emoji: p.emoji } };
  try {
    const res = await fetch(`https://${ig ? "graph.instagram.com" : "graph.facebook.com"}/${ig ? graphVersion() : whatsappGraphVersion()}/${p.accountId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000), cache: "no-store",
    });
    const data = row(await res.json().catch(() => null));
    if (!res.ok || data.error) return { status: res.status >= 400 && res.status < 500 && data.error ? "failed" : "uncertain", externalId: null, error: "Kanali nuk konfirmoi reaction-in." };
    const externalId = ig ? data.message_id : rows(data.messages)[0]?.id;
    // Instagram sender actions may acknowledge success without a message ID.
    const conflictingRecipient = ig && data.recipient_id !== undefined && data.recipient_id !== p.to;
    const accepted = !conflictingRecipient && (validId(externalId) || ig && (data.success === true || data.recipient_id === p.to));
    return { status: accepted ? "sent" : "uncertain", externalId: !ig && validId(externalId) ? externalId : null, error: accepted ? null : "Përgjigje pa konfirmim të vlefshëm." };
  } catch {
    return { status: "uncertain", externalId: null, error: "Rezultati nuk dihet. Mos e ridërgo automatikisht." };
  }
}
