import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), read: {} as Record<string, unknown>, calls: [] as unknown[], bindings: vi.fn(), choices: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/workflows/visual/bindings", () => ({ loadVisualBindings: m.bindings }));
vi.mock("@/lib/workflows/visual/choices", () => ({ loadVisualFlowChoices: m.choices }));
import { prepareProductRemoval, executeProductRemoval } from "./removal";
const products = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: `Synthetic ${i}`, archived_at: null, updated_at: "2026-11-04T00:00:00Z", is_active: false }));
beforeEach(() => {
  vi.clearAllMocks(); m.calls = [];
  m.read = { data: products(13), count: 13, error: null };
  m.from.mockImplementation(() => {
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => Promise.resolve(m.read).then(resolve) };
    for (const method of ["select", "eq", "order", "range"]) q[method] = (...args: unknown[]) => { m.calls.push([method, ...args]); return q; };
    return q;
  });
  m.rpc.mockImplementation(async (name, args) => ({ data: name === "prepare_product_removal" ? products(13).filter(p => args.p_ids.includes(p.id)).map((p, i) => ({ ...p, operation: i === 0 ? "archive" : "delete" })) : { deleted: 12, archived: 1 }, error: null }));
});
it("resolves all 13 rows server-side and previews 12 deletions and one archive without executing", async () => {
  const result = await prepareProductRemoval("business", "owner", { scope: "all" });
  expect(result.rows).toHaveLength(13);
  expect(result.preview.subject).toBe("12 për fshirje · 1 për arkivim");
  expect(result.preview.fields[0].after).toContain("Arkivo");
  expect(m.calls).toContainEqual(["eq", "business_id", "business"]);
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("prepare_product_removal", { p_business: "business", p_user: "owner", p_ids: expect.arrayContaining(products(13).map(p => p.id)) });
});
it("refuses truncated catalogs instead of silently removing a subset", async () => {
  m.read = { data: products(12), count: 13, error: null };
  await expect(prepareProductRemoval("business", "owner", { scope: "all" })).rejects.toThrow("plotë");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("uses shared catalog query and status semantics", async () => {
  m.read = { data: products(13).map((p,i) => ({ ...p, is_active: i < 3 })), count: 13, error: null };
  const result = await prepareProductRemoval("business", "owner", { scope: "listed", query: "Synthetic 1", status: "active" });
  expect(result.rows.map(p => p.id)).toEqual([products(13)[1].id]);
});
it("does not treat business workflow inheritance as an unlinked product", async () => {
  m.read = { data: products(1).map(p => ({ ...p, product_type_id: "type" })), count: 1, error: null };
  m.bindings.mockResolvedValue({ enabled: false, versionId: null, products: [] });
  m.choices.mockResolvedValue({ workflow: { active: true } });
  await expect(prepareProductRemoval("business", "owner", { scope: "listed", status: "unlinked" })).rejects.toThrow("Nuk ka produkte");
  expect(m.rpc).not.toHaveBeenCalled();
});
it.each([{ data: products(101), count: 101, error: null }, { data: [], count: 0, error: null }])("does not truncate oversized or empty batches", async read => {
  m.read = read;
  await expect(prepareProductRemoval("business", "owner", { scope: "all" })).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects invalid and foreign explicit targets", async () => {
  await expect(prepareProductRemoval("business", "owner", { scope: "ids", ids: ["invalid"] })).rejects.toThrow();
  m.rpc.mockResolvedValue({ data: null, error: { message: "invalid_batch_targets" } });
  await expect(prepareProductRemoval("business", "owner", { scope: "ids", ids: [products(1)[0].id] })).rejects.toThrow("ky biznes");
});
it("sends only the reviewed rows to execution and uses backend counts", async () => {
  const { rows } = await prepareProductRemoval("business", "owner", { scope: "all" });
  expect(await executeProductRemoval("business", "owner", rows)).toEqual({ message: "U fshinë 12 produkte dhe u arkivuan 1.", path: "products" });
  expect(m.rpc).toHaveBeenLastCalledWith("execute_product_removal", { p_business: "business", p_user: "owner", p_rows: rows });
});
it.each(["stale_product", "product_has_history"])("reports %s without success or silent fallback", async code => {
  m.rpc.mockResolvedValue({ error: { message: code }, data: null });
  await expect(executeProductRemoval("business", "owner", [])).rejects.toThrow("Asgjë nga grupi");
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
