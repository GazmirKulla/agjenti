import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ select: vi.fn(), rows: [] as Record<string, unknown>[], filters: [] as unknown[][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: (...f: unknown[]) => { m.filters.push(f); return q; }, limit: async () => ({ data: m.rows, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/conversations/understanding/selection", async original => ({ ...(await original<object>()), selectSemanticCandidates: m.select }));
import { findProfileOverlaps, PROFILE_TOPICS_QUERY } from "./overlap";
import { SelectionUnavailable } from "@/lib/conversations/understanding/selection";

const entry = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, body: `${title} …`, intent_key: null, updated_at: "2026-11-25T10:00:00Z", ...extra });
beforeEach(() => { vi.clearAllMocks(); m.filters = []; m.rows = [entry("k1", "Kontakti"), entry("s1", "Konsulta", { intent_key: "service" }), entry("k2", "Pagesat")]; });

it("matches active knowledge by meaning against what the profile holds, and proposes only confident matches", async () => {
  m.select.mockResolvedValue([{ index: 0, score: 0.9, evidence: "adresa" }, { index: 1, score: 0.4, evidence: "orari" }]);
  expect(await findProfileOverlaps("b")).toEqual([{ id: "k1", title: "Kontakti", excerpt: "Kontakti …", updatedAt: "2026-11-25T10:00:00Z", evidence: "adresa" }]);
  // Service mirrors are not offered; only this business's active entries are read.
  expect(m.select).toHaveBeenCalledWith("relevance", [{ title: "Kontakti", body: "Kontakti …" }, { title: "Pagesat", body: "Pagesat …" }], PROFILE_TOPICS_QUERY);
  expect(m.filters).toEqual([["business_id", "b"], ["is_active", true]]);
});

it("reports a failed AI read as failed, never as 'nothing repeats'", async () => {
  m.select.mockRejectedValue(new SelectionUnavailable());
  await expect(findProfileOverlaps("b")).rejects.toBeInstanceOf(SelectionUnavailable);
  m.rows = [];
  expect(await findProfileOverlaps("b")).toEqual([]);
});
