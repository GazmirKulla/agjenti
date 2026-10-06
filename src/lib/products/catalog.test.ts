import { describe, it, expect } from "vitest";
import { catalogFilter, catalogStatus, type ProductRow } from "./catalog";
const product = (id: string, patch: Partial<ProductRow> = {}): ProductRow => ({
  id,
  name: "Puzzle",
  description: "Foto e personalizuar",
  sku: "PZ-1",
  image_url: null,
  source: "manual",
  external_id: null,
  price_amount: 20,
  currency: "EUR",
  product_type_id: "type",
  workflow_id: "workflow",
  is_active: true,
  created_at: "2026-10-01",
  ...patch,
});
describe("catalog organization", () => {
  it("distinguishes mapping from activation without pretending missing workflows are ready", () => {
    expect(catalogStatus(product("1"))).toBe("active");
    expect(catalogStatus(product("2", { is_active: false }))).toBe("draft");
    expect(catalogStatus(product("3", { workflow_id: null }))).toBe("unlinked");
  });
  it("combines search, type, import and status filters then sorts", () => {
    const rows = [
      product("1"),
      product("2", {
        name: "Bluzë",
        sku: "BLZ-2",
        price_amount: 10,
        is_active: false,
        source: "linked",
        created_at: "2026-10-03",
      }),
    ];
    expect(
      catalogFilter(rows, "blz", "draft", "type", "name").map((p) => p.id),
    ).toEqual(["2"]);
    expect(
      catalogFilter(rows, "foto", "imports", "", "price").map((p) => p.id),
    ).toEqual(["2"]);
    expect(
      catalogFilter(rows, "", "all", "", "newest").map((p) => p.id),
    ).toEqual(["2", "1"]);
  });
});
