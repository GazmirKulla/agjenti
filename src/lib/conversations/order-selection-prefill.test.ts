import { describe, expect, it } from "vitest";
import { checkSelection, emptySelection, hasChoices, selectionInput } from "./order-selection-prefill";
import type { OrderProduct } from "@/lib/products/order-products";

const puzzle: OrderProduct = {
  id: "p1", name: "Puzzle me foto", price: 1500, currency: "ALL", unit: null, image: null, sendsToWebsite: true,
  variants: [
    { id: "v-a4", label: "Masa: A4 · Copëza: 96", price: 1500, externalId: "a4" },
    { id: "v-a3", label: "Masa: A3 · Copëza: 192", price: 2200, externalId: "a3" },
  ],
  declared: {
    options: [{ key: "theme", label: "Tema", required: true, affectsPrice: false, values: [{ id: "frozen", name: "Frozen" }, { id: "cars", name: "Cars" }] }],
    addons: [{ id: "box", name: "Kuti dhuratë", price: 300 }, { id: "frame", name: "Kornizë A3", price: 500, appliesToVariants: ["a3"] }],
    fields: [
      { key: "name", label: "Emri në puzzle", type: "text", appliesTo: "item", required: false, maxLength: 20 },
      { key: "age", label: "Mosha", type: "number", appliesTo: "item", required: false, min: 1, max: 15 },
      { key: "gift", label: "Dhuratë", type: "boolean", appliesTo: "item", required: false },
      { key: "photo", label: "Foto", type: "photo", appliesTo: "item", required: true },
    ],
  },
};

const sure = (entry: Record<string, unknown>) => ({ evidence: "nga biseda", sure: true, ...entry });

describe("checkSelection", () => {
  it("keeps the sure picks that exist on the product", () => {
    const out = checkSelection(puzzle, {
      variant: sure({ id: "v-a3" }),
      options: [sure({ key: "theme", value_id: "frozen" })],
      addons: [sure({ id: "box" }), sure({ id: "frame" })],
      fields: [sure({ key: "name", value: "Ana" }), sure({ key: "age", value: "5" }), sure({ key: "gift", value: "true" })],
    });
    expect(out.variantId?.value).toBe("v-a3");
    expect(out.options.theme?.value).toBe("frozen");
    expect(out.addons.map((a) => a.value)).toEqual(["box", "frame"]);
    expect(out.fields).toMatchObject({ name: { value: "Ana" }, age: { value: "5" }, gift: { value: "true" } });
    expect(out.variantId?.source).toBe("biseda");
  });

  it("drops what the model is not sure of", () => {
    const out = checkSelection(puzzle, {
      variant: { id: "v-a3", evidence: "", sure: false },
      options: [{ key: "theme", value_id: "cars", evidence: "", sure: false }],
      addons: [], fields: [],
    });
    expect(emptySelection(out)).toBe(true);
  });

  it("drops unknown ids, photo fields and values outside the field", () => {
    const out = checkSelection(puzzle, {
      variant: sure({ id: "v-xl" }),
      options: [sure({ key: "theme", value_id: "barbie" }), sure({ key: "color", value_id: "red" })],
      addons: [sure({ id: "ribbon" })],
      fields: [sure({ key: "photo", value: "x.jpg" }), sure({ key: "age", value: "40" }), sure({ key: "name", value: "Një emër shumë i gjatë për puzzle" })],
    });
    expect(out.variantId).toBeNull();
    expect(out.options).toEqual({});
    expect(out.addons).toEqual([]);
    expect(out.fields.photo).toBeUndefined();
    expect(out.fields.age).toBeUndefined();
    expect(out.fields.name?.value).toHaveLength(20);
  });

  it("keeps an extra for some variants only with one of them", () => {
    const out = checkSelection(puzzle, { variant: sure({ id: "v-a4" }), options: [], addons: [sure({ id: "frame" })], fields: [] });
    expect(out.addons).toEqual([]);
  });

  it("survives a broken answer", () => {
    expect(emptySelection(checkSelection(puzzle, null))).toBe(true);
    expect(emptySelection(checkSelection(puzzle, { variant: "v-a4", options: "theme" }))).toBe(true);
  });
});

describe("selectionInput", () => {
  it("never offers photos to the model and tells when there is nothing to pick", () => {
    expect(selectionInput(puzzle).fields.map((f) => f.key)).toEqual(["name", "age", "gift"]);
    expect(hasChoices(puzzle)).toBe(true);
    expect(hasChoices({ ...puzzle, variants: undefined, declared: undefined })).toBe(false);
  });
});
