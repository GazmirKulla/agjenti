import { describe, expect, it } from "vitest";
import { LinkedCatalogError, normalizeLinkedProduct } from "./linked-catalog";

describe("normalizeLinkedProduct", () => {
  it("reads a v2 product: variants by the website's ids, other choices, extras and fields", () => {
    const product = normalizeLinkedProduct({
      id: "shirt", name: "Bluzë", priceMode: "from", price: 1200, currency: "ALL",
      options: [
        { key: "format", label: "Masa", affectsPrice: true, values: [{ id: "f2", name: "2" }, { id: "f10", name: "10" }] },
        { key: "color", label: "Ngjyra", values: [{ id: "white", name: "E bardhë" }] },
      ],
      variants: [
        { id: "f2", options: { format: "f2" }, price: 1200, active: true },
        { id: "f10", options: { format: "f10" }, price: 1400, active: true },
        { id: "f10-copy", options: { format: "f10" }, price: 1500 },
        { id: "ghost", options: { format: "unknown" }, price: 1 },
      ],
      addons: [{ id: "base", name: "Bazë", price: 400, appliesToVariants: ["f10"] }, { id: "bad", name: "Pa çmim" }],
      fields: [
        { key: "character", label: "Personazhi", type: "text", appliesTo: "item", required: true, maxLength: 120 },
        { key: "photo", label: "Foto", type: "photo", required: false, max: 3 },
        { key: "format", label: "Përplasje me opsionin", type: "text" },
        { key: "Bad Key", label: "x", type: "text" },
      ],
    });
    expect(product).toMatchObject({ priceMode: "from", price: 1200, currency: "ALL" });
    expect(product.variants).toEqual([
      { external_id: "f2", options: { format: "2" }, sku: null, price_amount: 1200, is_active: true },
      { external_id: "f10", options: { format: "10" }, sku: null, price_amount: 1400, is_active: true },
    ]);
    expect(product.spec.options.find((o) => o.key === "color")).toMatchObject({ required: true, values: [{ id: "white", name: "E bardhë" }] });
    expect(product.spec.addons).toEqual([{ id: "base", name: "Bazë", price: 400, appliesToVariants: ["f10"] }]);
    expect(product.spec.fields.map((f) => f.key)).toEqual(["character", "photo"]);
  });

  it("reads a v1 product: formats become variants, colors an optional choice", () => {
    const product = normalizeLinkedProduct({ id: "p", name: "P", price: null, formats: [{ id: "a4", name: "A4", price: 1800 }, { id: "a3", name: "A3", price: 2700 }], colors: [{ id: "c", name: "Kuq" }] });
    expect(product).toMatchObject({ priceMode: "from", price: 1800 });
    expect(product.variants.map((v) => v.options)).toEqual([{ format: "A4" }, { format: "A3" }]);
    expect(product.spec.options.find((o) => o.key === "color")?.required).toBe(false);
  });

  it("falls back to a price on request when the website gives no amount", () => {
    expect(normalizeLinkedProduct({ id: "x", name: "X", priceMode: "fixed", price: null, options: [], variants: [] })).toMatchObject({ priceMode: "request", price: null });
  });

  it("refuses option keys the variants table cannot store", () => {
    expect(() => normalizeLinkedProduct({ id: "x", name: "X", options: [{ key: "Masa e madhe", values: [{ id: "1", name: "1" }] }], variants: [] })).toThrow(LinkedCatalogError);
  });
});
