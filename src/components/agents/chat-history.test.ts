import { describe, it, expect } from "vitest";
import { forkConversation, replaySession, readHistory, transcript, type ChatEntry, type TestConversation } from "./chat-history";
import { emptyState } from "@/lib/workflows/engine";
const entry = (id: string): ChatEntry => ({ id, text: `message ${id}`, photo: false, attachments: [], result: { session: `checkpoint-${id}`, reply: `reply ${id}`, nextState: emptyState(), previousResponseId: null, workflowId: null, productName: null, workflowProgress: [], turns: 1, autoReplyEnabled: true, debug: { source: "ai", model: "test", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } } });
const chat: TestConversation = { id: "one", title: "Test", entries: [entry("1"), entry("2"), entry("3")], updatedAt: 1 };
describe("test chat checkpoints", () => {
  it("regenerates from the checkpoint before a message, including the first turn", () => {
    expect(replaySession(chat.entries, 0)).toBeNull();
    expect(replaySession(chat.entries, 1)).toBe("checkpoint-1");
    expect(replaySession(chat.entries, 3)).toBe("checkpoint-3");
    expect(() => replaySession(chat.entries, -1)).toThrow();
  });
  it("forks an edited past message without inheriting later state or deleting the original", () => {
    const fork = forkConversation(chat, 1, entry("new"));
    expect(fork.entries.map(e=>e.id)).toEqual(["1", "new"]);
    expect(chat.entries.map(e=>e.id)).toEqual(["1", "2", "3"]);
    expect(fork.id).not.toBe(chat.id);
  });
  it("restores valid history, rejects corrupt data, and exports no session credentials", () => {
    expect(readHistory(JSON.stringify([chat]))).toEqual([chat]);
    expect(readHistory('{')).toEqual([]);
    expect(readHistory(JSON.stringify([{...chat,entries:[{result:{}}]}]))).toEqual([]);
    expect(transcript(chat)).toContain("message 1");
    expect(transcript(chat)).not.toContain("checkpoint");
  });
});
