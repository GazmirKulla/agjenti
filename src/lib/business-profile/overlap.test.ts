import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), rows: [] as Record<string, unknown>[], filters: [] as unknown[][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: (...f: unknown[]) => { m.filters.push(f); return q; }, limit: async () => ({ data: m.rows, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/ai/openai", () => ({ default: class { responses = { create: m.create }; } }));
import { findProfileOverlaps, OverlapUnavailable } from "./overlap";

const entry = (id: string, title: string, body: string, extra: Record<string, unknown> = {}) => ({ id, title, body, intent_key: null, updated_at: "2026-11-25T10:00:00Z", ...extra });
const reply = (matches: unknown[]) => m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ matches }) });
beforeEach(() => {
  vi.clearAllMocks(); m.filters = []; vi.stubEnv("OPENAI_API_KEY", "test");
  m.rows = [entry("k1", "Kontakti", "Na shkruani në 069 000 0000 ose në Rrugën e Kavajës."), entry("s1", "Konsulta", "Shërbim", { intent_key: "service" }), entry("k2", "Pagesat", "Paguani me kartë.")];
});
afterEach(() => vi.unstubAllEnvs());

it("keeps a confident match only when its evidence is quoted from that same entry", async () => {
  reply([{ index: 0, score: 0.9, evidence: "069 000 0000" }, { index: 1, score: 0.95, evidence: "069 000 0000" }, { index: 0, score: 0.9, evidence: "x" }]);
  expect(await findProfileOverlaps("b")).toEqual([{ id: "k1", title: "Kontakti", excerpt: "Na shkruani në 069 000 0000 ose në Rrugën e Kavajës.", updatedAt: "2026-11-25T10:00:00Z", evidence: "069 000 0000" }]);
  // Only this business's active entries are read; service mirrors are never sent.
  expect(m.filters).toEqual([["business_id", "b"], ["is_active", true]]);
  expect(JSON.parse(m.create.mock.calls[0][0].input).candidates.map((c: { title: string }) => c.title)).toEqual(["Kontakti", "Pagesat"]);
});

it("drops low scores and quotes that are not in the entry", async () => {
  reply([{ index: 0, score: 0.4, evidence: "069 000 0000" }, { index: 1, score: 0.9, evidence: "069 000 0000" }]);
  expect(await findProfileOverlaps("b")).toEqual([]);
});

it("reports a failed AI read as failed, never as 'nothing repeats'", async () => {
  m.create.mockRejectedValue(new Error("429"));
  await expect(findProfileOverlaps("b")).rejects.toBeInstanceOf(OverlapUnavailable);
  m.create.mockResolvedValue({ status: "incomplete", output_text: "" });
  await expect(findProfileOverlaps("b")).rejects.toBeInstanceOf(OverlapUnavailable);
  m.rows = [];
  expect(await findProfileOverlaps("b")).toEqual([]);
});
