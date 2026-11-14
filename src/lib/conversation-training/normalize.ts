import { createHash } from "node:crypto";
import { redact } from "@/lib/conversation-learning/transcripts";
import type { ExportThread } from "./instagram-export";

export type Speaker = "customer" | "owner" | "agent";
/** One message as kept for training: no names, no contact details. */
export type TrainingMessage = {
  thread_key: string; speaker: Speaker; body: string; sent_at: string;
  content_hash: string;
  /** Hashes of the same message one minute earlier or later: the Inbox and the
   * export may record the same message a few seconds apart. */
  nearby_hashes: [string, string];
};
export type Turn = { speaker: Speaker; text: string; at: string; count: number };

export const MAX_BODY = 2000;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const normal = (text: string) => text.normalize("NFC").toLocaleLowerCase("sq").replace(/\s+/g, " ").trim();

/** A one-way key for a conversation: the same customer gives the same key
 * within a business, and nothing about them can be read back from it. */
export function threadKey(businessId: string, identity: string) {
  return sha(`thread|${businessId}|${normal(identity)}`).slice(0, 32);
}

/** The same text from the same side at the same minute is one message. The owner's
 * messages and the agent's both speak for the business. Without `thread` the hash
 * only recognises the agent's own messages inside an export. */
export function messageHash(businessId: string, side: "business" | "customer", at: Date, text: string, thread = "") {
  const minute = Math.floor(at.getTime() / 60_000);
  return sha(`msg|${businessId}|${thread}|${side}|${minute}|${normal(text)}`);
}
function hashes(businessId: string, thread: string, side: "business" | "customer", at: Date, text: string) {
  const minute = 60_000;
  return {
    content_hash: messageHash(businessId, side, at, text, thread),
    nearby_hashes: [messageHash(businessId, side, new Date(at.getTime() - minute), text, thread), messageHash(businessId, side, new Date(at.getTime() + minute), text, thread)] as [string, string],
  };
}
const nearbyMinutes = (businessId: string, at: Date, text: string) =>
  [-1, 0, 1].map((offset) => messageHash(businessId, "business", new Date(at.getTime() + offset * 60_000), text));

/** Removes contact details and the names of the conversation's people. */
export function maskText(text: string, names: string[] = []): string {
  let out = redact(text.replace(/\r\n?/g, "\n").trim());
  const words = [...new Set(names.flatMap((name) => [name.trim(), ...name.trim().split(/\s+/)]))]
    .filter((word) => word.length >= 3).sort((a, b) => b.length - a.length);
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "giu"), "$1[emri]");
  }
  return out.length > MAX_BODY ? `${out.slice(0, MAX_BODY - 1)}…` : out;
}

export type ThreadOutcome = { messages: TrainingMessage[]; skipped?: "group" | "no_customer" | "empty" };

/** The messages of one exported conversation, from the business's side or the
 * customer's. `agentHashes` are messages the Agjenti agent sent: in the export they
 * look like the owner's, but they are not the owner's own style. */
export function exportThreadMessages(businessId: string, thread: ExportThread, owner: string, agentHashes: Set<string> = new Set()): ThreadOutcome {
  const others = [...new Set(thread.participants.concat(thread.messages.map((m) => m.sender)))].filter((name) => name !== owner);
  if (others.length > 1) return { messages: [], skipped: "group" };
  const customer = others[0];
  if (!customer) return { messages: [], skipped: "no_customer" };
  const key = threadKey(businessId, `instagram-export:${customer}`);
  const messages: TrainingMessage[] = [];
  for (const m of thread.messages) {
    if (m.sender !== owner && m.sender !== customer) continue;
    const body = maskText(m.text, [customer]);
    if (!body) continue;
    const side = m.sender === owner ? "business" : "customer";
    const h = hashes(businessId, key, side, m.at, m.text);
    const agent = side === "business" && agentHashes.size > 0 && nearbyMinutes(businessId, m.at, m.text).some((hash) => agentHashes.has(hash));
    messages.push({ thread_key: key, speaker: side === "customer" ? "customer" : agent ? "agent" : "owner", body, sent_at: m.at.toISOString(), ...h });
  }
  return messages.length ? { messages } : { messages: [], skipped: "empty" };
}

export type StoredLine = { source: "customer" | "staff" | "agent"; body: string; created_at: string };
/** The messages of one conversation stored in the Agjenti Inbox. */
export function inboxThreadMessages(businessId: string, identity: string, lines: StoredLine[], names: string[] = []): TrainingMessage[] {
  const key = threadKey(businessId, identity);
  return lines.flatMap((line) => {
    const body = maskText(String(line.body ?? ""), names);
    if (!body) return [];
    const at = new Date(line.created_at);
    if (Number.isNaN(at.getTime())) return [];
    const side = line.source === "customer" ? "customer" : "business";
    const speaker: Speaker = line.source === "customer" ? "customer" : line.source === "agent" ? "agent" : "owner";
    return [{ thread_key: key, speaker, body, sent_at: at.toISOString(), ...hashes(businessId, key, side, at, String(line.body)) }];
  });
}

/** Hashes of the agent's own messages, to recognise them inside an export. */
export function agentMessageHashes(businessId: string, lines: { body: string; created_at: string }[]) {
  const out = new Set<string>();
  for (const line of lines) {
    const at = new Date(line.created_at);
    if (!line.body || Number.isNaN(at.getTime())) continue;
    out.add(messageHash(businessId, "business", at, line.body));
  }
  return out;
}

/** Several quick messages from the same person read as one turn of the
 * conversation ("Përshëndetje" / "sa kushton" / "bateria?"). */
export function toTurns(messages: { speaker: Speaker; body: string; sent_at: string }[], gapMinutes = 10): Turn[] {
  const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const turns: Turn[] = [];
  let lastAt = 0;
  for (const m of sorted) {
    const at = Date.parse(m.sent_at);
    const previous = turns.at(-1);
    if (previous && previous.speaker === m.speaker && at - lastAt <= gapMinutes * 60_000) {
      previous.text = `${previous.text}\n${m.body}`;
      previous.count++;
    } else turns.push({ speaker: m.speaker, text: m.body, at: m.sent_at, count: 1 });
    lastAt = at;
  }
  return turns;
}

/** Keeps the first copy of each message (by hash or a hash one minute away). */
export function withoutDuplicates(messages: TrainingMessage[], known: Set<string> = new Set()): TrainingMessage[] {
  const seen = new Set(known);
  const out: TrainingMessage[] = [];
  for (const m of messages) {
    if (seen.has(m.content_hash) || m.nearby_hashes.some((hash) => seen.has(hash))) continue;
    seen.add(m.content_hash);
    out.push(m);
  }
  return out;
}
