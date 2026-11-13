import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot, type FactInput, type Snapshot } from "./contracts";
import { compileVisualProcesses } from "./visual-definition";
import { definitionFor, recordPresentation, transitionCustomer, type Environment } from "./transition";
import { orderFields, orderToolPolicy } from "./order-definition";
import { orderContext, orderQuantityField, readOrderTerms, validOrderQuantity } from "./order-context";
import type { VisualVersion } from "@/lib/workflows/visual/types";

// The catalog the order context reads; the model's interpretation is given as structured observations.
const { catalog } = vi.hoisted(() => ({ catalog: { product: {} as Record<string, unknown>, variants: [] as unknown[] } }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => undefined }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain,
    maybeSingle: async () => ({ data: table === "products" ? catalog.product : { product_fields: [{ key: "gjatesia", label: "Gjatësia", type: "select", unit: "m", variant: true }] }, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ data: catalog.variants, error: null }) };
  return chain;
} }) }));

const wood = "11111111-1111-4111-8111-111111111111";
const board = { id: wood, name: "Dërrasë pishe", product_type_id: null, price_amount: 1200, price_mode: "fixed", price_unit: "m³", currency: "ALL", attributes: {} };
beforeEach(() => { catalog.product = { ...board }; catalog.variants = []; });
const version: VisualVersion = { id: "visual", businessId: "business", createdAt: "today", graph: { version: 2, name: "Shop", flows: [
  { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product"] }], nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "start-done", source: "start", target: "done", port: "next" }, { id: "product-done", source: "product", target: "done", port: "next" }] } };
const { key } = orderFields("order");
const customer = { customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" };

async function setup() {
  const definitions = compileVisualProcesses(version), orders = orderContext([version]);
  const env: Environment = { mode: "test", now: 1, promptTtlMs: 60000, definitions, startableVersionIds: new Set([version.id]), tools: [orderToolPolicy()],
    bindDependencies: (instance, eventId) => { const previous = instance.productWorkflow?.productId; instance.productWorkflow = { productId: String(instance.facts[key("productId")]?.value), workflowId: null, versionId: null }; orders.clearVariants(instance, previous, eventId); },
    resolveDefinition: (definition, instance) => orders.withVariants(definition, instance), serverFacts: (definition, instance) => orders.serverFacts(definition, instance) };
  const event = { id: "start", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Dërrasë pishe" };
  const start = { revision: 0, needsClarification: false, commands: [{ kind: "start" as const, definitionId: "order", versionId: version.id, evidence: event.message,
    initialFacts: Object.entries({ [key("productId")]: wood, ...customer }).map(([fieldId, value]) => ({ fieldId, value, evidence: event.message })) }] };
  const empty = initialSnapshot("business", "conversation", "test");
  await orders.prepare(empty, definitions, start);
  const first = transitionCustomer(empty, event, start, env);
  const id = first.state.focusId!;
  let n = 0;
  const answer = (state: Snapshot, values: FactInput[]) => transitionCustomer(state, { ...event, id: `answer-${++n}`, message: values.map(v => v.evidence).join(" ") },
    { revision: state.revision, needsClarification: false, commands: [{ kind: "facts", instanceId: id, values }] }, env);
  const approve = (state: Snapshot) => {
    const instance = state.instances[id], shown = recordPresentation(state, [instance.wait!.id], 1);
    return transitionCustomer(shown, { ...event, id: `approve-${++n}`, message: "Po" }, { revision: shown.revision, needsClarification: false,
      commands: [{ kind: "approve", instanceId: id, waitId: instance.wait!.id, evidence: "Po" }] }, env);
  };
  return { first, env, id, answer, approve, orders, definitions };
}
const quantity = (value: number, evidence: string): FactInput[] => [{ fieldId: orderQuantityField, value, evidence }];

it("asks how much of the unit right after the product, before the review", async () => {
  const h = await setup();
  const instance = h.first.state.instances[h.id];
  expect(instance.wait?.fieldId).toBe(orderQuantityField);
  expect(definitionFor(h.first.state, instance, h.env).fields.find(f => f.id === orderQuantityField))
    .toMatchObject({ type: "number", required: true, label: "Quantity in m³", min: 0.001, max: 100000, step: 0.001 });
});

// The same structured value, however the customer said it; the language is the model's job, not the runtime's.
it.each([["gjysmë kubi", 0.5], ["half a cubic metre", 0.5], ["0,5 m3", 0.5], ["një kub e çerek", 1.25], ["3 kubik", 3], ["mezzo metro cubo", 0.5]])(
  "orders %s as %s m³ with the quantity in the reviewed terms", async (evidence, value) => {
    const h = await setup();
    const ready = h.answer(h.first.state, quantity(value, evidence));
    const instance = ready.state.instances[h.id];
    expect(definitionFor(ready.state, instance, h.env).steps.find(s => s.id === instance.stepId)).toMatchObject({ kind: "confirm", fieldIds: expect.arrayContaining([orderQuantityField]) });
    expect(instance.facts[key("quantity")]?.value).toBe(value);
    const done = h.approve(ready.state);
    expect(done.actions).toHaveLength(1);
    expect(done.actions[0].input).toMatchObject({ quantity: value, unitAmount: 1200, options: "{}" });
  });

it.each([[0, "asnjë"], [-1, "minus një"], [0.0005, "gjysmë litri"], [100000.5, "shumë"], [Number.NaN, "?"]])("rejects %s as a quantity", async (value, evidence) => {
  const h = await setup();
  expect(() => h.answer(h.first.state, quantity(value, evidence))).toThrow();
  expect(validOrderQuantity(value)).toBe(false);
});

it("a question in between keeps the pending quantity question", async () => {
  const h = await setup();
  const asked = transitionCustomer(h.first.state, { id: "question", businessId: "business", conversationId: "conversation", actor: "customer", message: "A e prisni në masë?" },
    { revision: h.first.state.revision, needsClarification: false, commands: [] }, h.env);
  expect(asked.state.instances[h.id].wait?.fieldId).toBe(orderQuantityField);
  expect(asked.actions).toHaveLength(0);
});

it("a corrected quantity needs a new review; the earlier approval is not reused", async () => {
  const h = await setup();
  const ready = h.answer(h.first.state, quantity(0.5, "gjysmë kubi"));
  const firstWait = ready.state.instances[h.id].wait!.id;
  const corrected = h.answer(ready.state, quantity(2, "jo, dy kube"));
  const instance = corrected.state.instances[h.id];
  expect(instance.wait?.id).not.toBe(firstWait);
  expect(instance.facts[key("quantity")]?.value).toBe(2);
  expect(() => transitionCustomer(corrected.state, { id: "old", businessId: "business", conversationId: "conversation", actor: "customer", message: "Po" },
    { revision: corrected.state.revision, needsClarification: false, commands: [{ kind: "approve", instanceId: h.id, waitId: firstWait, evidence: "Po" }] }, h.env)).toThrow();
  expect(h.approve(corrected.state).actions[0].input).toMatchObject({ quantity: 2 });
});

it("a product without a unit is one item and is not asked a quantity", async () => {
  catalog.product = { ...board, price_unit: null };
  const h = await setup();
  const instance = h.first.state.instances[h.id];
  expect(definitionFor(h.first.state, instance, h.env).fields.some(f => f.id === orderQuantityField)).toBe(false);
  expect(instance.facts[key("quantity")]?.value).toBe(1);
  expect(h.approve(h.first.state).actions[0].input).toMatchObject({ quantity: 1 });
});

it("asks the variant first, then the quantity, and prices with the chosen variant", async () => {
  catalog.variants = [{ id: "v3", options: { gjatesia: "3" }, sku: null, price_amount: 1300, is_active: true }, { id: "v4", options: { gjatesia: "4" }, sku: null, price_amount: 1400, is_active: true }];
  const h = await setup();
  expect(h.first.state.instances[h.id].wait?.fieldId).toBe("variant_gjatesia");
  const chosen = h.answer(h.first.state, [{ fieldId: "variant_gjatesia", value: "4", evidence: "4 metra" }]);
  expect(chosen.state.instances[h.id].wait?.fieldId).toBe(orderQuantityField);
  const done = h.approve(h.answer(chosen.state, quantity(0.25, "një çerek kubi")).state);
  expect(done.actions[0].input).toMatchObject({ quantity: 0.25, unitAmount: 1400, options: '{"variant_gjatesia":"4"}' });
});

it("the order is checked again against the catalog with the reviewed quantity", async () => {
  await expect(readOrderTerms("business", wood, false, {}, 0.5)).resolves.toMatchObject({ quantity: 0.5, unitAmount: 1200 });
  await expect(readOrderTerms("business", wood, false, {}, 0.0001)).rejects.toThrow("invalid_quantity");
  await expect(readOrderTerms("business", wood, false, {}, "0.5")).rejects.toThrow("invalid_quantity");
  catalog.product = { ...board, price_unit: null };
  // Without a unit the current terms say one item, so a reviewed 0.5 no longer matches them.
  await expect(readOrderTerms("business", wood, false, {}, 0.5)).resolves.toMatchObject({ quantity: 1 });
});
