import type { TestChatResult } from "@/lib/agents/test-chat/actions";
import type { TestAttachment } from "@/lib/agents/test-chat/attachments";
export type ChatTurn = Exclude<TestChatResult, { error: string }>;
export type ChatEntry = { id: string; text: string; photo: boolean; attachments: (TestAttachment & { preview?: string })[]; result: ChatTurn };
export type TestConversation = { id: string; title: string; entries: ChatEntry[]; updatedAt: number };
export function newConversation(): TestConversation {
  return { id: crypto.randomUUID(), title: "Bisedë e re", entries: [], updatedAt: Date.now() };
}
/** Replay from BEFORE the edited/regenerated message, never from its result. */
export function replaySession(entries: ChatEntry[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index > entries.length) throw new Error("Invalid replay index");
  return index ? entries[index - 1].result.session : null;
}
export function forkConversation(chat: TestConversation, index: number, entry: ChatEntry): TestConversation {
  replaySession(chat.entries, index);
  return { id: crypto.randomUUID(), title: `${chat.title.slice(0, 55)} · version`, entries: [...chat.entries.slice(0, index), entry], updatedAt: Date.now() };
}
export function transcript(chat: TestConversation) {
  return `# ${chat.title}\n\n` + chat.entries.map(e => `Ti:\n${e.text}${e.photo ? "\n[Foto e simuluar]" : ""}${e.attachments.map(a => `\n[Skedar: ${a.name}]`).join("")}\n\nAgjenti:\n${e.result.reply}`).join("\n\n---\n\n");
}
export function readHistory(raw: string | null): TestConversation[] {
  try {
    if (!raw || raw.length > 4000000) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: TestConversation) => c && typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.entries) && c.entries.length <= 40 && c.entries.every(e => e && typeof e.id === "string" && typeof e.text === "string" && Array.isArray(e.attachments) && e.attachments.every(a => typeof a.name === "string" && typeof a.token === "string" && ["image", "document"].includes(a.kind)) && typeof e.result?.session === "string" && typeof e.result.reply === "string" && e.result.nextState?.customer && e.result.nextState.fields && e.result.debug)).slice(0, 8);
  } catch { return []; }
}
