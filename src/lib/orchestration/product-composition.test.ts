import { expect, it } from "vitest";
import { initialSnapshot, type Snapshot, type FactInput } from "./contracts";
import { compileVisualProcesses } from "./visual-definition";
import { linearProcessVersion } from "./linear-definition";
import { productDependencies } from "./product-dependencies";
import { definitionFor, recordPresentation, transitionCustomer, type Environment } from "./transition";
import { orderFields, orderToolPolicy } from "./order-definition";
import type { VisualVersion } from "@/lib/workflows/visual/types";
const product = "11111111-1111-4111-8111-111111111111";
const parent: VisualVersion = { id: "visual", businessId: "business", createdAt: "today", graph: { version: 2, name: "Shop", flows: [
  { id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product", "note"] }], nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "note", kind: "collect", label: "Gift note", position: { x: 0, y: 0 }, config: { fieldKey: "gift", fieldType: "text", prompt: "Gift note?" } },
    { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }], edges: [
      { id: "start-done", source: "start", target: "done", port: "next" }, { id: "product-note", source: "product", target: "note", port: "next" }, { id: "note-done", source: "note", target: "done", port: "next" }] } };
const child = linearProcessVersion({ id: "linear-v1", businessId: "business", workflowId: "customization", name: "Customization", productIds: [product], steps: [
  { key: "size", kind: "choice", options: ["S", "M"], required: true }, { key: "delivery", kind: "customer" }] });
function setup(collection = false) {
  const version = structuredClone(parent);
  if (collection) version.collectionPolicy = { version: 1, revision: 1, scopes: [{ versionId: version.id, flowId: "order", domain: "order", mode: "collection_only", profileFields: [] }] };
  const definitions = compileVisualProcesses(version), { key } = orderFields("order");
  const versions = new Map([[version.id, version], [child.id, child]]);
  const env: Environment = { mode: "test", now: 1, promptTtlMs: 60000, definitions, startableVersionIds: new Set([version.id]), tools: [orderToolPolicy()],
    ...productDependencies(versions, [version, child]), serverFacts: (_d, instance) => ({ [key("productName")]: "Product", [key("productTypeId")]: "none", [key("unitAmount")]: 25,
      [key("currency")]: "EUR", [key("quantity")]: 1, [key("options")]: JSON.stringify({ size: instance.facts.size?.value, gift: instance.facts.gift?.value }) }) };
  const event = { id: "start", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Product for Example Customer +355691234567 Tirane Example address" };
  const values = { [key("productId")]: product, ...(collection ? {} : { customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" }) };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "order", versionId: version.id, evidence: event.message, initialFacts: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence: event.message })) }] }, env);
  const id = first.state.focusId!;
  const answer = (state: Snapshot, values: FactInput[]) => transitionCustomer(state, { ...event, id: "answer", message: "M Happy birthday" }, { revision: state.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: id, values }] }, env);
  return { first, env, event, id, versions, answer };
}
it("collects product steps, returns to the visual graph and creates exactly one approved order", () => {
  const h = setup();
  expect(h.first.state.instances[h.id].wait?.fieldId).toBe("size");
  expect(h.first.state.instances[h.id].productWorkflow).toEqual({ productId: product, workflowId: "customization", versionId: "linear-v1" });
  const options = h.answer(h.first.state, [{ fieldId: "size", value: "M", evidence: "M" }]);
  expect(options.state.instances[h.id].wait?.fieldId).toBe("gift");
  const ready = h.answer(options.state, [{ fieldId: "gift", value: "Happy birthday", evidence: "Happy birthday" }]);
  expect(ready.actions).toEqual([]);
  const instance = ready.state.instances[h.id], definition = definitionFor(ready.state, instance, h.env);
  expect(definition.steps.filter(s => s.kind === "effect" && s.tool === "order.create")).toHaveLength(1);
  expect(definition.steps.find(s => s.id === instance.stepId)).toMatchObject({ kind: "confirm", fieldIds: expect.arrayContaining(["size", "gift"]) });
  const shown = recordPresentation(ready.state, [instance.wait!.id], 1);
  const result = transitionCustomer(shown, { ...h.event, id: "approve", message: "Proceed" }, { revision: shown.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: instance.wait!.id, evidence: "Proceed" }] }, h.env);
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].input.options).toBe('{"size":"M","gift":"Happy birthday"}');
});
it("keeps a selected product's pinned version when a new linear version is published", () => {
  const h = setup(), next = structuredClone(child); next.id = "linear-v2"; next.linear!.steps[0].options = ["XL"];
  h.versions.set(next.id, next);
  Object.assign(h.env, productDependencies(h.versions, [parent, next]));
  const result = h.answer(h.first.state, [{ fieldId: "size", value: "M", evidence: "M" }]);
  expect(result.state.instances[h.id].productWorkflow?.versionId).toBe("linear-v1");
  expect(result.state.instances[h.id].wait?.fieldId).toBe("gift");
});
it("respects collection-only profile policy while retaining configured product options", () => {
  const h = setup(true);
  const result = h.answer(h.first.state, [{ fieldId: "size", value: "M", evidence: "M" }, { fieldId: "gift", value: "Happy birthday", evidence: "Happy birthday" }]);
  const instance = result.state.instances[h.id];
  expect(instance.status).toBe("waiting_approval");
  expect(Object.keys(instance.facts)).not.toContain("customer_name");
  expect(definitionFor(result.state, instance, h.env).steps.some(s => s.kind === "effect")).toBe(false);
});
