import { beforeEach, expect, it, vi } from "vitest";
type Call = { table: string; op: string; values?: unknown; filters: unknown[][] };
const m = vi.hoisted(() => ({ calls: [] as Call[], rpc: vi.fn(), pendingIds: [] as string[], others: false, written: true, remaining: 0 }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: (table: string) => {
  const call: Call = { table, op: "select", filters: [] }; m.calls.push(call);
  const result = () => table === "business_discovery_jobs"
    ? { data: [{ checkpoint: { review: { status: "pending", knowledgeIds: m.pendingIds, ...(m.others ? { agent: { instructions: "x" } } : {}) } } }], error: null }
    : call.op === "select" ? { count: m.remaining, error: null } : { data: m.written ? { id: "x" } : null, error: null };
  const chain = {
    select: () => chain, eq: (...f: unknown[]) => { call.filters.push(f); return chain; }, in: (...f: unknown[]) => { call.filters.push(f); return chain; },
    update: (values: unknown) => { call.op = "update"; call.values = values; return chain; }, delete: () => { call.op = "delete"; return chain; },
    maybeSingle: async () => result(), then: (ok: (r: unknown) => unknown) => Promise.resolve(result()).then(ok),
  };
  return chain;
} }) }));
vi.mock("./queue", () => ({ enqueueDiscovery: vi.fn(), enqueuePublicInstagram: vi.fn() }));
import { decideSourceEntry } from "./sources-step";

const id = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
beforeEach(() => { m.calls = []; m.rpc.mockReset().mockResolvedValue({ data: { kept: 0, removed: 0 }, error: null }); m.pendingIds = [id]; m.others = false; m.written = true; m.remaining = 0; });

it("accepting puts only this pending entry in use, scoped to the business and still inactive", async () => {
  m.remaining = 1;
  expect(await decideSourceEntry("b", "u", { id, decision: "accept" })).toEqual({ decided: "accept", closed: false });
  const write = m.calls.find(c => c.op === "update")!;
  expect(write).toMatchObject({ table: "knowledge_entries", values: { is_active: true } });
  expect(write.filters).toEqual([["business_id", "b"], ["id", id], ["is_active", false]]);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("refusing removes the entry, and the last decision closes a proposal with nothing else in it", async () => {
  expect(await decideSourceEntry("b", "u", { id, decision: "reject" })).toEqual({ decided: "reject", closed: true });
  expect(m.calls.find(c => c.op === "delete")?.filters).toContainEqual(["is_active", false]);
  expect(m.rpc).toHaveBeenCalledWith("review_discovery", { p_business: "b", p_user: "u", p_keep: [] });
});

it("leaves the proposal open while it still holds other changes for their own decision", async () => {
  m.others = true;
  expect(await decideSourceEntry("b", "u", { id, decision: "accept" })).toMatchObject({ closed: false });
  expect(m.rpc).not.toHaveBeenCalled();
});

it("never touches an entry outside the pending proposal, and does not report success for a changed one", async () => {
  m.pendingIds = [];
  await expect(decideSourceEntry("b", "u", { id, decision: "accept" })).rejects.toThrow("pritje");
  expect(m.calls.some(c => c.op !== "select")).toBe(false);
  m.pendingIds = [id]; m.written = false;
  await expect(decideSourceEntry("b", "u", { id, decision: "accept" })).rejects.toThrow("ndryshoi");
  await expect(decideSourceEntry("b", "u", { id, decision: "maybe" })).rejects.toThrow();
});

it("saves the owner's edit with the acceptance", async () => {
  await decideSourceEntry("b", "u", { id, decision: "accept", edit: { title: "Dërgesa", body: "Brenda 24 orësh." } });
  expect(m.calls.find(c => c.op === "update")?.values).toMatchObject({ is_active: true, title: "Dërgesa", body: "Brenda 24 orësh." });
});
