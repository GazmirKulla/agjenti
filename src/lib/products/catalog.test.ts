import { describe, it, expect } from "vitest";
import { catalogFilter, catalogStatus, productMoney, type ProductRow } from "./catalog";
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
    expect(catalogStatus(product("3", { workflow_id: null }))).toBe("active");
    expect(catalogStatus(product("4", { workflow_id: null, visual_workflow: { versionId: "v", flowId: "order", name: "Porosi" } }))).toBe("active");
    expect(catalogStatus(product("5", { workflow_id: null, business_workflow: { name: "Main", active: true, status: "Aktiv" } }))).toBe("active");
    expect(catalogStatus(product("6", { workflow_id: null, business_workflow: { name: "Main", active: false, status: "Draft" } }))).toBe("active");
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

describe("productMoney", () => {
  it("shows ranges per unit, a starting price and prices on request", () => {
    expect(productMoney(70000, "ALL", { mode: "range", max: 80000, unit: "m³" })).toBe("70,000–80,000 Lekë / m³");
    expect(productMoney(500, "EUR", { mode: "from" })).toBe("Nga 500 EUR");
    expect(productMoney(null, "ALL", { mode: "request" })).toBe("Sipas kërkesës");
    expect(productMoney(1800, "ALL")).toBe("1,800 Lekë");
    expect(productMoney(null, "ALL")).toBe("Pa çmim");
  });
});
