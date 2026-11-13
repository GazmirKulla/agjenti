import { expect, it } from "vitest";
import { initialSnapshot, type Snapshot, type FactInput } from "./contracts";
import { compileVisualProcesses } from "./visual-definition";
import { definitionFor, recordPresentation, transitionCustomer, type Environment } from "./transition";
import { orderFields, orderToolPolicy } from "./order-definition";
import { composeVariantChoices, variantUnitAmount } from "./order-context";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { BusinessField } from "@/lib/items/fields";
import type { ProductVariant } from "@/lib/products/variants";

const product = "11111111-1111-4111-8111-111111111111";
const version: VisualVersion = { id: "visual", businessId: "business", createdAt: "today", graph: { version: 2, name: "Shop", flows: [
  { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product"] }], nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "start-done", source: "start", target: "done", port: "next" }, { id: "product-done", source: "product", target: "done", port: "next" }] } };
const fields: BusinessField[] = [{ key: "druri", label: "Druri", type: "text" }, { key: "gjatesia", label: "Gjatësia", type: "select", unit: "cm", variant: true }];
const variants: ProductVariant[] = [
  { options: { gjatesia: "80" }, sku: "D80", price_amount: null, is_active: true },
  { options: { gjatesia: "120" }, sku: "D120", price_amount: 800, is_active: true },
  { options: { gjatesia: "150" }, sku: "D150", price_amount: 950, is_active: false },
];

function setup() {
  const definitions = compileVisualProcesses(version), { key } = orderFields("order");
  const env: Environment = { mode: "test", now: 1, promptTtlMs: 60000, definitions, startableVersionIds: new Set([version.id]), tools: [orderToolPolicy()],
    resolveDefinition: (definition, instance) => instance.facts[key("productId")]?.value === product ? composeVariantChoices(definition, variants, fields) : definition,
    serverFacts: (_d, instance) => ({ [key("productName")]: "Dorezë druri", [key("productTypeId")]: "none",
      [key("unitAmount")]: variantUnitAmount(variants, 500, Object.fromEntries(Object.entries(instance.facts).map(([id, f]) => [id, f.value])))!,
      [key("currency")]: "ALL", [key("quantity")]: 1, [key("options")]: JSON.stringify(instance.facts.variant_gjatesia ? { variant_gjatesia: instance.facts.variant_gjatesia.value } : {}) }) };
  const event = { id: "start", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Dorezë druri for Example Customer +355691234567 Tirane Example address" };
  const values = { [key("productId")]: product, customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "order", versionId: version.id, evidence: event.message, initialFacts: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence: event.message })) }] }, env);
  const id = first.state.focusId!;
  const answer = (state: Snapshot, values: FactInput[]) => transitionCustomer(state, { ...event, id: "answer", message: values.map(v => v.evidence).join(" ") }, { revision: state.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: id, values }] }, env);
  return { first, env, event, id, answer };
}

it("asks for the variant right after the product, offering only active values", () => {
  const h = setup();
  const instance = h.first.state.instances[h.id];
  expect(instance.wait?.fieldId).toBe("variant_gjatesia");
  const field = definitionFor(h.first.state, instance, h.env).fields.find(f => f.id === "variant_gjatesia");
  expect(field).toMatchObject({ type: "choice", required: true, label: "Gjatësia (cm)", options: ["80", "120"] });
});

it("prices the order with the chosen variant and sends the choice in the options", () => {
  const h = setup();
  const ready = h.answer(h.first.state, [{ fieldId: "variant_gjatesia", value: "120", evidence: "120" }]);
  const instance = ready.state.instances[h.id];
  expect(definitionFor(ready.state, instance, h.env).steps.find(s => s.id === instance.stepId)).toMatchObject({ kind: "confirm", fieldIds: expect.arrayContaining(["variant_gjatesia"]) });
  const shown = recordPresentation(ready.state, [instance.wait!.id], 1);
  const result = transitionCustomer(shown, { ...h.event, id: "approve", message: "Po" }, { revision: shown.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: instance.wait!.id, evidence: "Po" }] }, h.env);
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].input).toMatchObject({ unitAmount: 800, options: '{"variant_gjatesia":"120"}' });
});

it("rejects a value that is not one of the product's variants", () => {
  const h = setup();
  expect(() => h.answer(h.first.state, [{ fieldId: "variant_gjatesia", value: "150", evidence: "150" }])).toThrow();
});

it("a variant without its own price takes the product's price", () => {
  expect(variantUnitAmount(variants, 500, { variant_gjatesia: "80" })).toBe(500);
  expect(variantUnitAmount(variants, null, {})).toBe(800);
  expect(variantUnitAmount([], 500)).toBe(500);
});

it("without variant rows, asks for each list kept on the product; rows win when there are any", () => {
  const definition = compileVisualProcesses(version)[0];
  const lists = { gjatesia: ["2", "3", "4"], trashesia: ["3", "5"] };
  const listed = composeVariantChoices(definition, [], fields, lists);
  expect(listed.fields.filter(f => f.id.startsWith("variant_")).map(f => [f.id, f.type === "choice" ? f.options : []]))
    .toEqual([["variant_gjatesia", ["2", "3", "4"]], ["variant_trashesia", ["3", "5"]]]);
  const rows = composeVariantChoices(definition, variants, fields, lists);
  expect(rows.fields.filter(f => f.id.startsWith("variant_")).map(f => f.id)).toEqual(["variant_gjatesia"]);
});

it("a variant without its own price is not orderable when the product's price is not fixed", () => {
  expect(variantUnitAmount(variants, null, { variant_gjatesia: "80" })).toBeNull();
  expect(variantUnitAmount(variants, null, { variant_gjatesia: "120" })).toBe(800);
});
