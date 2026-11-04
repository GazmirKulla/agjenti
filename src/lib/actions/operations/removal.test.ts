import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./access", () => ({ operationActor: m.actor }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
import { prepareOperation, executeOperation } from "./service";
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, name: "Synthetic", updated_at: "2026-11-04T00:00:00Z", operation: "delete" };
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({ userId: "owner", business: { id: "business", name: "Synthetic", catalog_source: "internal" } });
  m.rpc.mockImplementation(async name => ({ error: null, data: name === "prepare_product_removal" ? [row] : name === "claim_business_operation" ? { execute: true } : { deleted: 1, archived: 0 } }));
  m.from.mockImplementation(() => {
    const q = { update: () => q, select: () => q, eq: () => q, returns: () => q, maybeSingle: async () => ({ data: { ...row }, error: null }) };
    return q;
  });
});
it("preparation pins explicit IDs; execution uses the same receipt and the reviewed snapshot", async () => {
  const prepared = await prepareOperation("business", "owner", "product.remove", { scope: "ids", ids: [id] });
  expect(prepared.input).toEqual({ scope: "ids", ids: [id] });
  expect(m.rpc.mock.calls.map(c => c[0])).toEqual(["prepare_product_removal"]);
  expect(await executeOperation("business", "owner", prepared)).toEqual({ message: "U fshinë 1 produkte dhe u arkivuan 0.", path: "products" });
  expect(m.rpc).toHaveBeenCalledWith("claim_business_operation", { p_id: prepared.requestId, p_business: "business", p_user: "owner", p_operation: "product.remove" });
  expect(m.rpc).toHaveBeenLastCalledWith("execute_product_removal", { p_business: "business", p_user: "owner", p_rows: [row] });
});
it("a repeated batch confirmation replays its receipt without removing products again", async () => {
  const prepared = await prepareOperation("business", "owner", "product.remove", { scope: "ids", ids: [id] });
  m.rpc.mockResolvedValue({ data: { execute: false, state: "completed", result: { message: "Done", path: "products" } }, error: null });
  expect(await executeOperation("business", "owner", prepared)).toEqual({ message: "Done", path: "products" });
  expect(m.rpc.mock.calls.some(c => c[0] === "execute_product_removal")).toBe(false);
});
it("preflights individual deletion as well, without turning it silently into archive", async () => {
  m.rpc.mockResolvedValue({ data: [{ ...row, operation: "archive" }], error: null });
  await expect(prepareOperation("business", "owner", "product.delete", { id })).rejects.toThrow("Përgatit arkivimin");
  expect(m.rpc.mock.calls.map(c => c[0])).toEqual(["prepare_product_removal"]);
});
it("external catalog and revoked access are checked before catalog reads", async () => {
  m.actor.mockResolvedValueOnce({ userId: "owner", business: { id: "business", catalog_source: "external" } }).mockRejectedValueOnce(Error("Revoked"));
  await expect(prepareOperation("business", "owner", "product.remove", { scope: "all" })).rejects.toThrow("jashtëm");
  await expect(prepareOperation("business", "owner", "product.remove", { scope: "all" })).rejects.toThrow("Revoked");
  expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
