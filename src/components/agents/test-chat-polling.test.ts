import { expect, it } from "vitest";
import { blockedByFailedTurn, needsTestChatPolling, TestChatPolling } from "./test-chat-polling";
import type { PendingTestTurn, TestConversation } from "./chat-history";
const operation = (sequence: number, status: PendingTestTurn["status"] = "queued"): PendingTestTurn => ({ id: `request-${sequence}`, sequence, status, accepted: true, text: "test", photo: false, attachments: [], session: null });
const chat = (...outbox: PendingTestTurn[]): TestConversation => ({ id: "stream", title: "Test", entries: [], updatedAt: 0, outbox });
it("stops requests for failed streams and their queued successors, preserving retry identities", () => {
  const state = chat(operation(0, "failed"), operation(1));
  const before = structuredClone(state), scheduler = new TestChatPolling();
  expect(blockedByFailedTurn(state, state.outbox![1])).toBe(true);
  for (let now = 0; now < 60000; now += 1000) expect(scheduler.due(state, now)).toBe(false);
  expect(state).toEqual(before);
  state.outbox![0].status = "queued";
  expect(scheduler.due(state, 60000)).toBe(true);
  expect(state.outbox!.map(o => o.id)).toEqual(["request-0", "request-1"]);
});
it("reduces requests during unchanged processing and resumes quickly when new work arrives", () => {
  const state = chat(operation(0, "processing")), scheduler = new TestChatPolling();
  const requests: number[] = [];
  for (let now = 0; now <= 30000; now += 1000) if (scheduler.due(state, now)) requests.push(now);
  expect(requests).toEqual([0, 1000, 3000, 7000, 15000, 30000]);
  state.outbox!.push(operation(1));
  expect(scheduler.due(state, 31000)).toBe(true);
});
it("continues reconciling uncertain results and resets on reconnection without retrying an effect", () => {
  const state = chat(operation(0, "uncertain")), scheduler = new TestChatPolling();
  expect(needsTestChatPolling(state)).toBe(true);
  expect(scheduler.due(state, 0)).toBe(true);
  expect(scheduler.due(state, 500)).toBe(false);
  scheduler.reconnect();
  expect(scheduler.due(state, 500)).toBe(true);
  expect(state.outbox![0].status).toBe("uncertain");
  expect(scheduler.due(chat(), 1000)).toBe(false);
});
it("keeps independent conversations runnable when another has failed", () => {
  const scheduler = new TestChatPolling();
  expect(scheduler.due(chat(operation(0, "failed")), 0)).toBe(false);
  expect(scheduler.due({ ...chat(operation(0)), id: "other" }, 0)).toBe(true);
});
