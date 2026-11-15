import { expect, it } from "vitest";
import { initialSnapshot, type Snapshot, type FactInput } from "./contracts";
import { compileVisualProcesses } from "./visual-definition";
import { definitionFor, recordPresentation, transitionCustomer, type Environment } from "./transition";
import { orderFields, orderToolPolicy } from "./order-definition";
import { composeSpecChoices, specFieldIds, variantUnitAmount } from "./order-context";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { ProductVariant } from "@/lib/products/variants";
import type { LinkedSpec } from "@/lib/integrations/linked-catalog";

const product = "22222222-2222-4222-8222-222222222222";
const version: VisualVersion = { id: "visual", businessId: "business", createdAt: "today", graph: { version: 2, name: "Shop", flows: [
  { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product"] }], nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "start-done", source: "start", target: "done", port: "next" }, { id: "product-done", source: "product", target: "done", port: "next" }] } };
// A website's puzzle: the format is the variant, the theme a choice, the character and a photo item details.
const spec: LinkedSpec = { version: 2, addons: [],
  options: [
    { key: "format", label: "Formati", required: true, affectsPrice: true, values: [{ id: "a4", name: "A4" }, { id: "a3", name: "A3" }, { id: "a2", name: "A2" }] },
    { key: "theme", label: "Tema", required: true, affectsPrice: false, values: [{ id: "t1", name: "Frozen" }, { id: "t2", name: "Stitch" }] },
    { key: "color", label: "Ngjyra", required: false, affectsPrice: false, values: [{ id: "red", name: "Red" }] }],
  fields: [
    { key: "character", label: "Personazhi", type: "text", appliesTo: "item", required: true },
    { key: "photo", label: "Fotoja", type: "photo", appliesTo: "item", required: true, max: 2 },
    { key: "email", label: "Email", type: "text", appliesTo: "order", required: false }] };
const variants: ProductVariant[] = [
  { options: { format: "A4" }, sku: null, price_amount: 1800, is_active: true },
  { options: { format: "A3" }, sku: null, price_amount: 2700, is_active: true },
  { options: { format: "A2" }, sku: null, price_amount: 3500, is_active: false },
];

function setup() {
  const definitions = compileVisualProcesses(version), { key } = orderFields("order");
  const env: Environment = { mode: "test", now: 1, promptTtlMs: 60000, definitions, startableVersionIds: new Set([version.id]), tools: [orderToolPolicy()],
    resolveDefinition: (definition, instance) => instance.facts[key("productId")]?.value === product ? composeSpecChoices(definition, spec, variants) : definition,
    serverFacts: (_d, instance) => ({ [key("productName")]: "Puzzle me foto", [key("productTypeId")]: "none",
      [key("unitAmount")]: variantUnitAmount(variants, null, Object.fromEntries(Object.entries(instance.facts).map(([id, f]) => [id, f.value])))!,
      [key("currency")]: "ALL", [key("quantity")]: 1, [key("options")]: "{}" }) };
  const event = { id: "start", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Puzzle for Example Customer +355691234567 Tirane Example address" };
  const values = { [key("productId")]: product, customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "order", versionId: version.id, evidence: event.message, initialFacts: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence: event.message })) }] }, env);
  const id = first.state.focusId!;
  const answer = (state: Snapshot, values: FactInput[], photo = false) => transitionCustomer(state, { ...event, id: `answer-${state.revision}`, message: values.map(v => v.evidence).join(" ") || "foto" },
    { revision: state.revision, needsClarification: false, commands: [{ kind: "facts", instanceId: id, values }] }, { ...env, photoReceived: photo });
  return { first, env, event, id, answer };
}

it("asks the catalog's questions right after the product: the variant, the choices, then the item details", () => {
  const h = setup();
  const instance = h.first.state.instances[h.id];
  const definition = definitionFor(h.first.state, instance, h.env);
  expect(instance.wait?.fieldId).toBe("variant_format");
  expect(definition.fields.find(f => f.id === "variant_format")).toMatchObject({ type: "choice", required: true, options: ["A4", "A3"] });
  expect(definition.fields.find(f => f.id === "theme")).toMatchObject({ type: "choice", required: true, options: ["Frozen", "Stitch"] });
  expect(definition.fields.find(f => f.id === "color")).toMatchObject({ required: false });
  expect(definition.fields.find(f => f.id === "character")).toMatchObject({ type: "text", required: true });
  expect(definition.fields.find(f => f.id === "photo")).toMatchObject({ type: "photo", required: true });
  // Order-level fields belong to the order, not to the item's questions.
  expect(definition.fields.some(f => f.id === "email")).toBe(false);
});

it("reviews the order only after the required catalog answers and the photo, priced by the chosen variant", () => {
  const h = setup();
  let state = h.answer(h.first.state, [{ fieldId: "variant_format", value: "A3", evidence: "A3" }, { fieldId: "theme", value: "Frozen", evidence: "Frozen" },
    { fieldId: "character", value: "Elsa", evidence: "Elsa" }]).state;
  expect(state.instances[h.id].wait?.fieldId).toBe("photo");
  // A photo is never a stated fact: it counts when the customer sends one to the shown question.
  const asked = recordPresentation(state, [state.instances[h.id].wait!.id], 1);
  state = transitionCustomer(asked, { ...h.event, id: "photo", message: "" }, { revision: asked.revision, needsClarification: false, commands: [] },
    { ...h.env, photoReceived: true }).state;
  const instance = state.instances[h.id];
  const review = definitionFor(state, instance, h.env).steps.find(s => s.id === instance.stepId);
  expect(review).toMatchObject({ kind: "confirm", fieldIds: expect.arrayContaining(["variant_format", "theme", "character", "photo"]) });
  const shown = recordPresentation(state, [instance.wait!.id], 1);
  const result = transitionCustomer(shown, { ...h.event, id: "approve", message: "Po" }, { revision: shown.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: instance.wait!.id, evidence: "Po" }] }, h.env);
  expect(result.actions[0].input).toMatchObject({ unitAmount: 2700 });
});

it("refuses a value the catalog does not offer", () => {
  const h = setup();
  expect(() => h.answer(h.first.state, [{ fieldId: "theme", value: "Batman", evidence: "Batman" }])).toThrow();
  expect(() => h.answer(h.first.state, [{ fieldId: "variant_format", value: "A2", evidence: "A2" }])).toThrow();
});

it("does not ask twice what the workflow already asks under the same key, and knows its own keys", () => {
  const definition = compileVisualProcesses(version)[0];
  const once = composeSpecChoices(definition, spec, variants);
  expect(composeSpecChoices(once, spec, variants)).toBe(once);
  expect(specFieldIds(spec, variants)).toEqual(["variant_format", "theme", "color", "character", "photo"]);
  expect(composeSpecChoices(definition, { version: 2, options: [], addons: [], fields: [] }, [])).toBe(definition);
});
