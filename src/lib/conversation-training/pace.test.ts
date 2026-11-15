import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { planBatches } from "./analysis";
import { stalled } from "./sessions";

const thread = (id: string, chars: number) => ({ thread: id, turns: [{ speaker: "customer" as const, text: "x".repeat(chars), at: "2026-11-15T10:00:00.000Z" }] }) as never;

describe("extraction batches", () => {
  it("splits the next conversations in order into at most the parallel batches", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const plan = planBatches(keys, keys.map((k) => thread(k, 12_000)), 4);
    expect(plan).toHaveLength(4);
    expect(plan.map((b) => b.group.map((t: { thread: string }) => t.thread))).toEqual([["t0", "t1"], ["t2", "t3"], ["t4", "t5"], ["t6", "t7"]]);
    // The next step starts right after the last planned conversation.
    expect(plan.at(-1)!.end).toBe(8);
  });

  it("skips over conversations without anything to read inside the plan", () => {
    const keys = ["a", "b", "c"];
    const plan = planBatches(keys, [thread("a", 10), thread("c", 10)], 4);
    expect(plan).toHaveLength(1);
    expect(plan[0].end).toBe(3);
  });
});

describe("stalled imports", () => {
  const now = Date.parse("2026-11-15T10:00:00.000Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  it("are those overdue or whose worker stopped, not those in progress", () => {
    expect(stalled([{ status: "queued", next_attempt_at: ago(60) }], now)).toBe(true);
    expect(stalled([{ status: "running", leased_until: ago(1) }], now)).toBe(true);
    expect(stalled([{ status: "queued", next_attempt_at: ago(5) }], now)).toBe(false);
    expect(stalled([{ status: "running", leased_until: ago(-120) }], now)).toBe(false);
    expect(stalled([{ status: "ready", next_attempt_at: ago(600) }], now)).toBe(false);
  });
});
