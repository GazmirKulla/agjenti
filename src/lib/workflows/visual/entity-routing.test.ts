import { beforeEach, expect, it, vi } from "vitest";
import { upgradeVisualGraph, starterVisualGraph } from "./model";
const m = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, filters: [] as unknown[], create: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: m.create }));
import { resolveVisualEntity } from "./entity-routing";
const p = "aaaaaaaa-0000-4000-8000-000000000001", s = "bbbbbbbb-0000-4000-8000-000000000002";
beforeEach(() => {
  m.filters = []; vi.clearAllMocks();
  m.rows = { products: [{ id: p, name: "Puzzle", sku: "PZ1", product_type_id: "type" }], booking_services: [{ id: s, name: "Konsultë", booking_enabled: false }] };
  m.create.mockImplementation(() => ({ from: (table: string) => {
    let bounds = [0, 499]; const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const chain = { select: () => chain, order: () => chain, range: (from: number, to: number) => { bounds = [from, to]; return chain; },
      eq: (key: string, value: unknown) => { m.filters.push([table, key, value]); filters.push(row => row[key] === value); return chain; },
      in: (key: string, values: unknown[]) => { m.filters.push([table, key, values]); filters.push(row => values.includes(row[key])); return chain; },
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: m.rows[table]?.map(row => ({ is_active: true, business_id: "business", ...row as Record<string, unknown> })).filter(row => filters.every(filter => filter(row))).slice(bounds[0], bounds[1] + 1), error: null })) };
    return chain;
  } }));
});
function graph() { const graph = upgradeVisualGraph(starterVisualGraph()); graph.flows.find(flow => flow.kind === "order")!.productIds = [p]; graph.flows.find(flow => flow.kind === "information")!.serviceIds = [s]; return graph; }
it("resolves active scoped entities by name or SKU and preserves a saved entity on short answers", async () => {
  const first = await resolveVisualEntity("business", graph(), "Dua Puzzle");
  expect(first.selected?.entity.id).toBe(p);
  expect((await resolveVisualEntity("business", graph(), "PZ1")).selected?.entity.id).toBe(p);
  expect((await resolveVisualEntity("business", graph(), "M", first.selected?.binding)).selected?.entity.id).toBe(p);
  expect(m.filters).toContainEqual(["products", "business_id", "business"]);
  expect(m.filters).toContainEqual(["booking_services", "business_id", "business"]);
  expect(m.filters).toContainEqual(["products", "is_active", true]);
});
it("supports nonbookable services and rejects unavailable/foreign IDs from graph state", async () => {
  expect((await resolveVisualEntity("business", graph(), "Konsultë")).selected?.entity).toMatchObject({ kind: "service", bookingEnabled: false });
  expect((await resolveVisualEntity("business", graph(), "", { flowId: "product", entity: { kind: "product", id: "foreign" } })).selected).toBeUndefined();
});
it("clarifies colliding entity names instead of guessing a flow", async () => {
  m.rows.booking_services = [{ id: s, name: "Puzzle", booking_enabled: false }];
  const result = await resolveVisualEntity("business", graph(), "Puzzle");
  expect(result.selected).toBeUndefined(); expect(result.choices).toHaveLength(2);
});
it("finds bound entries after the first 1000 catalog rows", async () => {
  m.rows.products = [...Array.from({ length: 1100 }, (_, index) => ({ id: `other-${index}`, name: `Item ${index}`, sku: null, product_type_id: null })), { id: p, name: "Puzzle", sku: "PZ1", product_type_id: "type" }];
  expect((await resolveVisualEntity("business", graph(), "Puzzle")).selected?.entity.id).toBe(p);
});
it("identifies a different active unbound product without pretending it is unavailable", async () => {
  m.rows.products.push({ id: "other", name: "Poster", sku: null, product_type_id: "type" });
  const result = await resolveVisualEntity("business", graph(), "Dua Poster", { flowId: "order", entity: { kind: "product", id: p } });
  expect(result.selected).toBeUndefined(); expect(result.mentioned?.id).toBe("other");
});
it("allows inactive entities only when explicitly bound and preview is enabled", async () => {
  m.rows.products = [{ id: p, name: "Puzzle", is_active: false }, { id: "inactive-unbound", name: "Poster", is_active: false }];
  m.rows.booking_services = [{ id: s, name: "Konsultë", booking_enabled: false, is_active: false }];
  expect((await resolveVisualEntity("business", graph(), "Puzzle")).selected).toBeUndefined();
  expect((await resolveVisualEntity("business", graph(), "Konsultë")).selected).toBeUndefined();
  const preview = await resolveVisualEntity("business", graph(), "Puzzle", undefined, true);
  expect(preview.selected?.entity.id).toBe(p);
  expect(preview.available?.map(entity => entity.id)).toEqual([p, s]);
  expect((await resolveVisualEntity("business", graph(), "Konsultë", undefined, true)).selected?.entity.id).toBe(s);
  expect((await resolveVisualEntity("business", graph(), "Poster", undefined, true)).mentioned).toBeUndefined();
  expect((await resolveVisualEntity("business", graph(), "M", preview.selected?.binding, true)).selected?.entity.id).toBe(p);
  expect((await resolveVisualEntity("business", graph(), "M", preview.selected?.binding)).selected).toBeUndefined();
});
it("preview never resolves a foreign tenant entity even when its ID is bound in the graph", async () => {
  m.rows.products = [{ id: p, name: "Puzzle", business_id: "other-business", is_active: false }];
  m.rows.booking_services = [{ id: s, name: "Konsultë", business_id: "other-business", is_active: true }];
  const result = await resolveVisualEntity("business", graph(), "Puzzle", undefined, true);
  expect(result.selected).toBeUndefined(); expect(result.available).toEqual([]);
  expect(m.filters.filter(filter => (filter as string[])[1] === "business_id")).toHaveLength(4);
  expect(m.filters).toContainEqual(["products", "id", [p]]);
  expect(m.filters).toContainEqual(["booking_services", "id", [s]]);
});
