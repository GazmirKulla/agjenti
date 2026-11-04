import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), from: vi.fn(), lifecycle: vi.fn(), writes: [] as Record<string, unknown>[], saveError: false }));
vi.mock("./access", () => ({ operationActor: m.actor }));
vi.mock("@/lib/products/lifecycle", () => ({ changeProductLifecycle: m.lifecycle }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
import { executeOperation, type PreparedOperation } from "./service";
const prepared: PreparedOperation = { version: 1, key: "product.delete", input: { id: "product" }, snapshot: { updated_at: "2026-11-04T00:00:00Z" }, requestId: "request", preview: { title: "Delete", fields: [] } };
beforeEach(() => {
  vi.clearAllMocks(); m.writes = []; m.saveError = false;
  m.actor.mockResolvedValue({ userId: "owner", business: { id: "business", catalog_source: "internal" } });
  m.rpc.mockResolvedValue({ data: { execute: true }, error: null });
  m.lifecycle.mockResolvedValue({ message: "Deleted", path: "products" });
  m.from.mockImplementation(() => {
    const q = { update: (v: Record<string, unknown>) => { m.writes.push(v); return q; }, eq: () => q, select: () => q,
      maybeSingle: async () => m.saveError ? { error: { message: "unavailable" }, data: null } : { data: { id: "request" }, error: null },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  });
});
it("replays a completed receipt without repeating a destructive action", async () => {
  m.rpc.mockResolvedValue({ data: { execute: false, state: "completed", result: { message: "Deleted", path: "products" } } });
  await expect(executeOperation("business", "owner", prepared)).resolves.toMatchObject({ message: "Deleted" });
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each(["running", "uncertain"])("does not retry a %s operation", async state => {
  m.rpc.mockResolvedValue({ data: { execute: false, state } });
  await expect(executeOperation("business", "owner", prepared)).rejects.toThrow("pasigurt");
  expect(m.lifecycle).not.toHaveBeenCalled();
});
it("cannot report success when the write succeeded but its receipt was lost", async () => {
  m.saveError = true;
  await expect(executeOperation("business", "owner", prepared)).rejects.toThrow("dëftesa");
  expect(m.lifecycle).toHaveBeenCalledOnce();
  expect(m.writes).toContainEqual(expect.objectContaining({ state: "uncertain" }));
});
it("rechecks identity before claiming or replaying a receipt", async () => {
  m.actor.mockRejectedValue(Error("Session changed"));
  await expect(executeOperation("business", "owner", prepared, "mobile-token")).rejects.toThrow("Session changed");
  expect(m.actor).toHaveBeenCalledWith("business", "owner", "mobile-token");
  expect(m.rpc).not.toHaveBeenCalled(); expect(m.lifecycle).not.toHaveBeenCalled();
});
