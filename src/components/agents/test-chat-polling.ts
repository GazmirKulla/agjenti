import type { PendingTestTurn, TestConversation } from "./chat-history";

export function blockedByFailedTurn(chat: TestConversation, operation: PendingTestTurn) {
  return chat.outbox?.some(other => other.sequence < operation.sequence && other.status === "failed") ?? false;
}
export function needsTestChatPolling(chat: TestConversation) {
  return chat.outbox?.some(operation => operation.status !== "failed" && !blockedByFailedTurn(chat, operation)) ?? false;
}

/** Per-stream scheduling only; never changes a request identity or its outcome. */
export class TestChatPolling {
  private streams = new Map<string, { signature: string; delay: number; next: number }>();
  due(chat: TestConversation, now: number) {
    if (!needsTestChatPolling(chat)) { this.streams.delete(chat.id); return false; }
    const signature = JSON.stringify([chat.entries.length, chat.outbox?.map(o => [o.id, o.status, o.accepted])]);
    const previous = this.streams.get(chat.id);
    if (!previous || previous.signature !== signature) {
      this.streams.set(chat.id, { signature, delay: 1000, next: now + 1000 });
      return true;
    }
    if (now < previous.next) return false;
    previous.delay = Math.min(previous.delay * 2, 15000);
    previous.next = now + previous.delay;
    return true;
  }
  reconnect() { this.streams.clear(); }
  retain(ids: string[]) { for (const id of this.streams.keys()) if (!ids.includes(id)) this.streams.delete(id); }
}
