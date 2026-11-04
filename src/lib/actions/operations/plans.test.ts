import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), execute: vi.fn(), from: vi.fn(), writes: [] as unknown[], stored: {} as Record<string, unknown> }));
vi.mock("./access", () => ({ operationActor: m.actor }));
vi.mock("./service", () => ({ executeOperation: m.execute, prepareOperation: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { parsePlan, executeOperationPlan, type PreparedPlan } from "./plans";
const plan = { id: "plan", fingerprint: "digest", steps: [1, 2, 3].map(n => ({ version: 1, key: "product.archive", input: { id: String(n) }, snapshot: { name: `Product ${n}`, updated_at: "time" }, requestId: String(n), preview: { title: `Archive ${n}`, fields: [] } })), preview: { title: "Plan", fields: [] } } as PreparedPlan;
beforeEach(() => {
  vi.clearAllMocks(); m.writes = []; m.stored = { fingerprint: "digest", steps: plan.steps };
  m.actor.mockResolvedValue({ userId: "owner" });
  m.execute.mockResolvedValue({ message: "Done", path: "products" });
  m.from.mockImplementation(() => {
    const q = { select: () => q, eq: () => q, update: (value: unknown) => { m.writes.push(value); return q; }, maybeSingle: async () => ({ data: m.stored, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) };
    return q;
  });
});
it("rejects forward dependencies and conflicting edits before persisting a plan", () => {
  expect(() => parsePlan([{ key: "product.edit", input: { id: "1" }, after: [1] }, { key: "product.archive", input: { id: "2" } }])).toThrow("mëparshëm");
  expect(() => parsePlan([{ key: "product.edit", input: { id: "1" } }, { key: "product.delete", input: { id: "1" } }])).toThrow("Bashko");
});
it("stops after an uncertain step and preserves already completed work", async () => {
  m.execute.mockResolvedValueOnce({ message: "Done" }).mockRejectedValueOnce(Error("Uncertain"));
  await expect(executeOperationPlan("business", "owner", plan)).rejects.toThrow("1/3");
  expect(m.execute.mock.calls.map(call => call[2].requestId)).toEqual(["1", "2"]);
  expect(m.writes).toContainEqual(expect.objectContaining({ state: "blocked" }));
});
it("accepts JSONB key ordering while retaining the exact reviewed steps and stable request IDs", async () => {
  m.stored.steps = plan.steps.map(step => ({ preview: step.preview, requestId: step.requestId, snapshot: { updated_at: "time", name: step.snapshot.name }, input: step.input, key: step.key, version: step.version }));
  await expect(executeOperationPlan("business", "owner", plan)).resolves.toMatchObject({ path: "activity" });
  expect(m.execute.mock.calls.map(call => call[2].requestId)).toEqual(["1", "2", "3"]);
  expect(m.writes).toContainEqual(expect.objectContaining({ state: "completed" }));
});
it("rejects changed plans or revoked access before dispatching any step", async () => {
  m.stored = { ...m.stored, steps: [] };
  await expect(executeOperationPlan("business", "owner", plan)).rejects.toThrow("ndryshoi");
  expect(m.execute).not.toHaveBeenCalled();
  m.actor.mockRejectedValue(Error("Revoked"));
  await expect(executeOperationPlan("business", "owner", plan)).rejects.toThrow("Revoked");
  expect(m.execute).not.toHaveBeenCalled();
});
