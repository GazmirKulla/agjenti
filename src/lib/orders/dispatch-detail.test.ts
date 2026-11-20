import { describe, expect, it } from "vitest";
import type { LinkedSpec } from "@/lib/integrations/linked-catalog";
import { itemHas, rejectionDetail } from "./dispatch-detail";

const spec: LinkedSpec = {
  version: 2, addons: [],
  options: [{ key: "color", label: "Ngjyra e kutisë", required: true, affectsPrice: false, values: [] }],
  fields: [{ key: "character", label: "Personazhi", type: "text", appliesTo: "item", required: true },
    { key: "photo", label: "Fotoja", type: "photo", appliesTo: "item", required: true }],
};
const specs = new Map([["puzzle", spec]]);

describe("rejectionDetail", () => {
  it("points a missing field at the first item that left it empty", () => {
    const items = [
      { productId: "puzzle", fields: { character: "Elsa" }, files: [{ key: "photo", path: "a.jpg" }] },
      { productId: "puzzle", fields: {}, files: [] },
    ];
    expect(rejectionDetail({ code: "missing_field", field: "character", items, specs })).toEqual({ field: "character", fieldLabel: "Personazhi", line: 2 });
    expect(rejectionDetail({ code: "missing_field", field: "photo", items, specs })).toEqual({ field: "photo", fieldLabel: "Fotoja", line: 2 });
  });
  it("names no item for an invalid value when the order has several", () => {
    const items = [{ productId: "puzzle", options: { color: "x" } }, { productId: "puzzle", options: { color: "y" } }];
    expect(rejectionDetail({ code: "invalid_option", field: "color", items, specs })).toEqual({ field: "color", fieldLabel: "Ngjyra e kutisë" });
    expect(rejectionDetail({ code: "invalid_option", field: "color", items: items.slice(0, 1), specs })).toEqual({ field: "color", fieldLabel: "Ngjyra e kutisë", line: 1 });
  });
  it("keeps order-level fields off the items and labels contract fields", () => {
    expect(rejectionDetail({ code: "missing_customer", field: "customer", items: [{}], specs })).toEqual({ field: "customer", fieldLabel: "Të dhënat e klientit" });
    expect(rejectionDetail({ code: "invalid_quantity", field: "quantity", items: [{ quantity: 0 }], specs: new Map() })).toEqual({ field: "quantity", fieldLabel: "Sasia", line: 1 });
  });
  it("takes the item the website named, and keeps customer details off the items", () => {
    const items = [{ productId: "puzzle", fields: {} }, { productId: "puzzle", fields: {} }];
    expect(rejectionDetail({ code: "missing_field", field: "character", item: 2, items, specs })).toEqual({ field: "character", fieldLabel: "Personazhi", line: 2 });
    expect(rejectionDetail({ code: "missing_field", field: "customer.address", items, specs })).toEqual({ field: "customer.address", fieldLabel: "Adresa" });
    expect(rejectionDetail({ code: "invalid_option", field: "color", item: 9, items, specs })).toEqual({ field: "color", fieldLabel: "Ngjyra e kutisë" });
  });
  it("returns nothing without a field and the bare key for an unknown one", () => {
    expect(rejectionDetail({ code: "price_changed", items: [{}], specs })).toEqual({});
    expect(rejectionDetail({ code: "missing_field", field: "engraving", items: [{}, {}], specs: new Map() })).toEqual({ field: "engraving", line: 1 });
  });
  it("reads options, details, top-level values and photos", () => {
    expect(itemHas({ options: { color: "red" } }, "color")).toBe(true);
    expect(itemHas({ fields: { character: "" } }, "character")).toBe(false);
    expect(itemHas({ character: "Elsa" }, "character")).toBe(true);
    expect(itemHas({ files: [{ key: "photo" }] }, "photo")).toBe(true);
  });
});

describe("why the website refused an order", () => {
  it("names the refusal and the field in the owner's words", async () => {
    const { refusalText } = await import("./dispatch-detail");
    expect(refusalText({ code: "missing_field", field: "customer.address" })).toBe("Webi e refuzoi: mungon një fushë (Adresa)");
    expect(refusalText({ code: "missing_payload" })).toBe("Webi e refuzoi: porosia mbërriti pa të dhëna");
    expect(refusalText({ code: "new_code_x" })).toBe("Webi e refuzoi: new_code_x");
    expect(refusalText(null)).toBeNull();
  });
});
