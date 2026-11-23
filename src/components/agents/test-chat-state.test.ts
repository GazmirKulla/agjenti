import { expect, it } from "vitest";
import { blockedByFailedTurn, hasInFlightTurns, hasRecoverableTurns } from "./test-chat-state";
import type { PendingTestTurn, TestConversation } from "./chat-history";
const operation = (sequence: number, status: PendingTestTurn["status"] = "queued"): PendingTestTurn => ({ id: `request-${sequence}`, sequence, status, accepted: true, text: "test", photo: false, attachments: [], session: null });
const chat = (...outbox: PendingTestTurn[]): TestConversation => ({ id: "stream", title: "Test", entries: [], updatedAt: 0, outbox });
it("failed predecessors block later turns without changing retry identities", () => {
  const state=chat(operation(0,"failed"),operation(1));
  expect(blockedByFailedTurn(state,state.outbox![1])).toBe(true);
  expect(hasRecoverableTurns(state)).toBe(false);
  state.outbox![0].status="queued";
  expect(hasRecoverableTurns(state)).toBe(true);
  expect(state.outbox!.map(o=>o.id)).toEqual(["request-0","request-1"]);
});
it("uncertain results remain recoverable without authorizing a second send", () => {
  const state=chat(operation(0,"uncertain"));
  expect(hasRecoverableTurns(state)).toBe(true);
  expect(state.outbox![0].status).toBe("uncertain");
  expect(hasRecoverableTurns(chat())).toBe(false);
});
it("treats failed outbox as idle so a new conversation can replace it", () => {
  expect(hasInFlightTurns(chat(operation(0, "failed")))).toBe(false);
  expect(hasInFlightTurns(chat(operation(0)))).toBe(true);
  expect(hasInFlightTurns(chat(operation(0, "processing")))).toBe(true);
  expect(hasInFlightTurns(chat(operation(0, "uncertain")))).toBe(true);
  const overflow = Array.from({ length: 9 }, (_, index) => ({ ...chat(operation(0, "failed")), id: `stream-${index}` }));
  expect(overflow.slice(8).some(hasInFlightTurns)).toBe(false);
  overflow[8] = { ...overflow[8], outbox: [operation(0, "queued")] };
  expect(overflow.slice(8).some(hasInFlightTurns)).toBe(true);
});
it("independent conversations remain runnable when another failed", () => {
  expect(hasRecoverableTurns(chat(operation(0,"failed")))).toBe(false);
  expect(hasRecoverableTurns({...chat(operation(0)),id:"other"})).toBe(true);
});
