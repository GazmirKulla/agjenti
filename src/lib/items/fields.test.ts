import { expect, it } from "vitest";
import { attributeFields, fieldKey, parseBusinessFields, readBusinessFields } from "./fields";
import { parseVariants, matchVariant, variantDetails } from "@/lib/products/variants";

it("makes accent-free keys and keeps them unique", () => {
  expect(fieldKey("Gjatësia (cm)")).toBe("gjatesia_cm");
  const parsed = parseBusinessFields([{ label: "Ngjyra" }, { label: "Ngjyra", variant: true }]);
  expect("fields" in parsed && parsed.fields.map(f => [f.key, f.type, f.variant ?? false])).toEqual([["ngjyra", "text", false], ["ngjyra_2", "select", true]]);
});
it("rejects lists without values, too many variant fields and names that are too short", () => {
  expect(parseBusinessFields([{ label: "Druri", type: "select" }])).toHaveProperty("error");
  expect(parseBusinessFields(Array.from({ length: 5 }, (_, i) => ({ label: `Masa ${i}`, variant: true })))).toHaveProperty("error");
  expect(parseBusinessFields([{ label: "x" }])).toHaveProperty("error");
});
it("reads stored fields tolerantly and exposes descriptive ones as form fields", () => {
  const fields = readBusinessFields([{ key: "druri", label: "Druri", type: "select", options: ["Ah", "Lis"] }, { key: "BAD", label: "x" }, null, { key: "gjatesia", label: "Gjatësia", variant: true }]);
  expect(fields.map(f => f.key)).toEqual(["druri", "gjatesia"]);
  expect(attributeFields(fields)).toEqual([{ key: "druri", label: "Druri", type: "select", summary: true, options: [{ value: "Ah", label: "Ah" }, { value: "Lis", label: "Lis" }] }]);
});
it("validates the variant table and finds the chosen variant", () => {
  const fields = [{ key: "gjatesia", label: "Gjatësia", type: "select" as const, variant: true }];
  expect(parseVariants([{ options: { gjatesia: "80" } }, { options: { gjatesia: "80" } }], fields)).toHaveProperty("error");
  expect(parseVariants([{ options: { gjatesia: "80" }, price_amount: "-1" }], fields)).toHaveProperty("error");
  const parsed = parseVariants([{ options: { gjatesia: "80", other: "x" }, sku: " D80 ", price_amount: "" }, { options: {} }, { options: { gjatesia: "120" }, price_amount: "800,5" }], fields);
  if (!("variants" in parsed)) throw Error("expected variants");
  expect(parsed.variants).toEqual([{ options: { gjatesia: "80" }, sku: "D80", price_amount: null, is_active: true }, { options: { gjatesia: "120" }, sku: null, price_amount: 800.5, is_active: true }]);
  expect(matchVariant(parsed.variants, { variant_gjatesia: "120" })?.price_amount).toBe(800.5);
  expect(matchVariant(parsed.variants, { variant_gjatesia: "100" })).toBeUndefined();
  expect(variantDetails(parsed.variants, fields, { price: 500, currency: "ALL" })).toBe("Gjatësia 80: 500 ALL; Gjatësia 120: 800.5 ALL");
  expect(variantDetails(parsed.variants, [{ ...fields[0], unit: "cm" }], { price: 500, currency: "ALL" })).toBe("Gjatësia 80 cm: 500 ALL; Gjatësia 120 cm: 800.5 ALL");
});
