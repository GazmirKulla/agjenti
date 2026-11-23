import type { PendingTestTurn, TestConversation } from "./chat-history";

export function blockedByFailedTurn(chat: TestConversation, operation: PendingTestTurn) {
  return chat.outbox?.some(other => other.sequence < operation.sequence && other.status === "failed") ?? false;
}
export function hasInFlightTurns(chat: TestConversation) {
  return chat.outbox?.some(operation => operation.status === "queued" || operation.status === "processing" || operation.status === "uncertain") ?? false;
}
export function hasRecoverableTurns(chat: TestConversation) {
  return chat.outbox?.some(operation => operation.status !== "failed" && !blockedByFailedTurn(chat, operation)) ?? false;
}

