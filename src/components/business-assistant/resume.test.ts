import { describe, expect, it } from "vitest";
import { RESUME_WINDOW_MS, shouldResume } from "./history";

const now = Date.parse("2026-11-20T12:00:00Z");
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
const view = (minutesAgo: number, extra: { pending?: boolean; kind?: "assistant" | "onboarding"; preview?: boolean } = {}) => ({
  conversation: { id: "c", title: "t", revision: 1, plan_revision: 0, updated_at: at(minutesAgo), pending_request: extra.pending ? "r" : null, pending_since: null },
  messages: [{ seq: 1, request_id: "r", role: "assistant" as const, kind: extra.kind ?? "assistant" as const, content: "x", context: {} as never, created_at: at(minutesAgo) }],
  plan: extra.preview ? { revision: 1, snapshot: { preview: { title: "x" } } as never, preferences: {} } : null,
});

describe("when the Assistant continues a conversation", () => {
  it("continues one active in the last 30 minutes and starts new after", () => {
    expect(shouldResume(view(5), now)).toBe(true);
    expect(shouldResume(view(RESUME_WINDOW_MS / 60000 + 1), now)).toBe(false);
  });
  it("always continues one with work still in it", () => {
    expect(shouldResume(view(600, { pending: true }), now)).toBe(true);
    expect(shouldResume(view(600, { preview: true }), now)).toBe(true);
    expect(shouldResume(view(600, { kind: "onboarding" }), now)).toBe(true);
  });
});
