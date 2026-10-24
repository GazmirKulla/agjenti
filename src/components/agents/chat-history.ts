import type { TestChatResult } from "@/lib/agents/test-chat/actions";
import type { TestAttachment } from "@/lib/agents/test-chat/attachments";
export type ChatTurn = Exclude<TestChatResult, { error: string }>;
export type ChatEntry = { id: string; batchId?: string; text: string; photo: boolean; attachments: (TestAttachment & { preview?: string })[]; result: ChatTurn };
export type PendingTestTurn = { id: string; batchId?: string; sequence: number; text: string; photo: boolean; attachments: ChatEntry["attachments"]; session: string | null; accepted?: boolean; status: "queued" | "processing" | "failed" | "uncertain"; error?: string };
export type TestConversation = { id: string; title: string; entries: ChatEntry[]; updatedAt: number; outbox?: PendingTestTurn[] };
export type TestTransportJob = { requestId: string; batchId?: string; sequence: number; status: string; error?: string; result?: ChatTurn | null };
/** Reconcile by operation identity and contiguous sequence, never response arrival order. */
export function reconcileTestConversation(chat: TestConversation, jobs: TestTransportJob[]): TestConversation {
  const entries = [...chat.entries];
  const outbox: PendingTestTurn[] = [];
  for (const pending of [...(chat.outbox ?? [])].sort((a,b) => a.sequence-b.sequence)) {
    if (entries.some(e => e.id === pending.id)) continue;
    const job = jobs.find(j => j.requestId === pending.id && j.sequence === pending.sequence);
    if (job?.status === "sent" && job.result && pending.sequence === entries.length) {
      entries.push({ id: pending.id, batchId: job.batchId, text: pending.text, photo: pending.photo, attachments: pending.attachments, result: job.result });
    } else outbox.push(job ? { ...pending, batchId: job.batchId, accepted: true, status: job.status === "failed" || job.status === "sent" && !job.result ? "failed" : job.status === "processing" ? "processing" : "queued", error: job.error } : pending);
  }
  return { ...chat, entries, outbox };
}
export function newConversation(): TestConversation {
  return { id: crypto.randomUUID(), title: "Bisedë e re", entries: [], updatedAt: Date.now() };
}
/** Replay from BEFORE the edited/regenerated message, never from its result. */
export function batchStartIndex(entries: ChatEntry[], index: number) {
  const batchId = entries[index]?.batchId;
  return batchId ? entries.findIndex(entry => entry.batchId === batchId) : index;
}
export function batchEntry(entries: ChatEntry[], index: number): ChatEntry {
  const entry = entries[index];
  return entry.batchId ? { ...entry, text: entries.filter(e => e.batchId === entry.batchId).map(e => e.text).join("\n") } : entry;
}
export function showsReply(entries: ChatEntry[], index: number) {
  return !entries[index].batchId || entries[index + 1]?.batchId !== entries[index].batchId;
}
export function replaySession(entries: ChatEntry[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index > entries.length) throw new Error("Invalid replay index");
  index = batchStartIndex(entries, index);
  return index ? entries[index - 1].result.session : null;
}
export function forkConversation(chat: TestConversation, index: number, entry: ChatEntry): TestConversation {
  replaySession(chat.entries, index);
  index = batchStartIndex(chat.entries, index);
  return { id: crypto.randomUUID(), title: `${chat.title.slice(0, 55)} · version`, entries: [...chat.entries.slice(0, index), entry], updatedAt: Date.now() };
}
export function transcript(chat: TestConversation) {
  return `# ${chat.title}\n\n` + chat.entries.map((e,i) => `Ti:\n${e.text}${e.photo ? "\n[Foto e simuluar]" : ""}${e.attachments.map(a => `\n[Skedar: ${a.name}]`).join("")}${showsReply(chat.entries,i) ? `\n\nAgjenti:\n${e.result.reply}` : ""}`).join("\n\n---\n\n");
}
function validOutbox(value: unknown): boolean {
  if (value === undefined) return true; // Pre-transport history remains readable.
  if (!Array.isArray(value) || value.length > 40) return false;
  return value.every(p => p && typeof p.id === "string" && Number.isInteger(p.sequence) && p.sequence >= 0 && p.sequence < 40 &&
    typeof p.text === "string" && p.text.length <= 2000 && typeof p.photo === "boolean" &&
    (p.session === null || typeof p.session === "string" && p.session.length <= 128000) &&
    ["queued", "processing", "failed", "uncertain"].includes(p.status) &&
    Array.isArray(p.attachments) && p.attachments.length <= 3 &&
    p.attachments.every((a: { name?: unknown; token?: unknown; kind?: unknown }) => a && typeof a.name === "string" && typeof a.token === "string" && ["image", "document"].includes(String(a.kind))));
}
export function readHistory(raw: string | null): TestConversation[] {
  try {
    if (!raw || raw.length > 4000000) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: TestConversation) => c && typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.entries) && validOutbox(c.outbox) && c.entries.length <= 40 && c.entries.every(e => e && typeof e.id === "string" && typeof e.text === "string" && Array.isArray(e.attachments) && e.attachments.every(a => typeof a.name === "string" && typeof a.token === "string" && ["image", "document"].includes(a.kind)) && typeof e.result?.session === "string" && typeof e.result.reply === "string" && e.result.nextState?.customer && e.result.nextState.fields && e.result.debug)).slice(0, 8);
  } catch { return []; }
}
