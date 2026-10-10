import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ calls: [] as { table: string; businessId: string; from: number; to: number }[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from(table: string) {
  let businessId = "";
  const query = { select: () => query, eq: (column: string, value: string) => { if (column !== "business_id") throw new Error("Unexpected filter"); businessId = value; return query; }, order: () => query,
    range: async (from: number, to: number) => {
      m.calls.push({ table, businessId, from, to });
      return { error: null, data: table === "products" ? Array.from({ length: from === 0 ? 1000 : 1 }, (_, i) => ({ id: `product-${from + i}`, name: `Produkt ${from + i}`, is_active: false })) : [{ id: "service-a", name: "Konsultë", is_active: true, booking_enabled: false }] };
    } };
  return query;
} }) }));
import { loadFlowBindingCatalog } from "./binding-catalog";
beforeEach(() => { m.calls.length = 0; });
it("reads all owned catalog pages including inactive products and non-bookable services", async () => {
  const result = await loadFlowBindingCatalog("business-a");
  expect(result.products).toHaveLength(1001);
  expect(result.products.at(-1)).toEqual({ id: "product-1000", name: "Produkt 1000", isActive: false });
  expect(result.services).toEqual([{ id: "service-a", name: "Konsultë", isActive: true, bookingEnabled: false }]);
  expect(m.calls.every(call => call.businessId === "business-a")).toBe(true);
  expect(m.calls.filter(call => call.table === "products").map(call => call.from)).toEqual([0, 1000]);
});
