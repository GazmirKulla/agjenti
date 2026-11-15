import { expect, it } from "vitest";
import { normalizeLinkedProduct } from "@/lib/integrations/linked-catalog";
import { composeSpecChoices } from "@/lib/orchestration/order-context";
import { compileVisualProcesses } from "@/lib/orchestration/visual-definition";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { orderOutputFields, outputFilePaths } from "./output-files";

const raw = {
  id: "p", name: "Puzzle", currency: "ALL", price: 1800,
  options: [{ key: "format", label: "Formati", required: true, values: [{ id: "a4", name: "A4" }] }],
  variants: [{ id: "a4", options: { format: "a4" }, price: 1800 }],
  fields: [
    { key: "photo", label: "Fotoja", type: "photo", appliesTo: "item", required: true, min: 1 },
    { key: "processed", label: "Foto e përpunuar", type: "photo", role: "output", required: true, min: 1, appliesTo: "order", max: 5 },
    { key: "note", label: "Shënim", type: "text", role: "output" },
  ],
};

it("reads the store's output photo fields: never required, always on the item, only photos or files", () => {
  const { spec } = normalizeLinkedProduct(raw, "ALL");
  expect(spec.fields).toEqual([
    { key: "photo", label: "Fotoja", type: "photo", appliesTo: "item", required: true, min: 1 },
    { key: "processed", label: "Foto e përpunuar", type: "photo", appliesTo: "item", required: false, role: "output", max: 5 },
  ]);
});

it("never asks the customer for the store's output photo", () => {
  const version: VisualVersion = { id: "v", businessId: "b", createdAt: "", graph: { version: 2, name: "Shop", flows: [
    { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product"] }], nodes: [
      { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 }, config: {} }, { id: "product", kind: "product", label: "P", position: { x: 0, y: 0 }, config: {} },
      { id: "done", kind: "end", label: "D", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "a", source: "start", target: "done", port: "next" }, { id: "b", source: "product", target: "done", port: "next" }] } };
  const { spec } = normalizeLinkedProduct(raw, "ALL");
  const composed = composeSpecChoices(compileVisualProcesses(version)[0], spec, [{ options: { format: "A4" }, sku: null, price_amount: 1800, is_active: true }]);
  expect(composed.fields.map((f) => f.id)).toContain("photo");
  expect(composed.fields.map((f) => f.id)).not.toContain("processed");
});

it("lists each item's output photo fields, by position", () => {
  const spec = normalizeLinkedProduct(raw, "ALL").spec;
  expect(orderOutputFields([
    { position: 2, products: { name: "Kuti", source: "internal", external_spec: spec } },
    { position: 1, products: [{ name: "Puzzle", source: "linked", external_spec: spec }] },
  ])).toEqual([
    { item: 1, productName: "Puzzle", outputFields: [{ key: "processed", label: "Foto e përpunuar", max: 5 }] },
    { item: 2, productName: "Kuti", outputFields: [] },
  ]);
});

it("accepts only this conversation's order files", () => {
  const b = "11111111-1111-4111-8111-111111111111", c = "22222222-2222-4222-8222-222222222222", f = "33333333-3333-4333-8333-333333333333";
  expect(outputFilePaths([`${b}/${c}/${f}.jpg`], b, c, 5)).toEqual([`${b}/${c}/${f}.jpg`]);
  expect(outputFilePaths([`${b}/other/${f}.jpg`], b, c, 5)).toBeNull();
  expect(outputFilePaths([`${b}/${c}/${f}.jpg`, `${b}/${c}/${f}.png`], b, c, 1)).toBeNull();
  expect(outputFilePaths([], b, c, 5)).toBeNull();
  expect(outputFilePaths([`${b}/${c}/${f}.jpg`], b, null, 5)).toBeNull();
});
