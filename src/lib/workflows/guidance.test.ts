import { expect, it } from "vitest";
import { recentConversation, rememberTurn } from "./guidance";
import { emptyState } from "./engine";

it("retains only a bounded transcript without mutating the prior state", () => {
  const state = { ...emptyState(), recentMessages: Array.from({ length: 20 }, () => ({ role: "user" as const, content: "a".repeat(3000) })) };
  const next = emptyState();
  rememberTurn(state, next, "hello", "reply");
  expect(recentConversation(next)).toHaveLength(10);
  expect(recentConversation(next).every(m => m.content.length <= 1200)).toBe(true);
  expect(state.recentMessages).toHaveLength(20);
});
