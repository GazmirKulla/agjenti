import { expect, it } from "vitest";
import { compileVisualProcesses } from "./visual-definition";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { initialSnapshot } from "./contracts";
import { orderFields, orderToolPolicy } from "./order-definition";
import { recordPresentation, transitionCustomer, type Environment } from "./transition";
const version: VisualVersion = { id: "v", businessId: "b", createdAt: "today", graph: { version: 2, name: "Shop", flows: [{ id: "order", label: "Order", kind: "order", entryNodeId: "product", nodeIds: ["product", "size"] }],
  nodes: [{ id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} }, { id: "product", kind: "product", label: "Product", position: { x: 0, y: 0 }, config: {} },
    { id: "size", kind: "collect", label: "Size", position: { x: 0, y: 0 }, config: { fieldKey: "size", fieldType: "text", prompt: "Size?" } }, { id: "done", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }],
  edges: [{ id: "s", source: "start", target: "done", port: "next" }, { id: "p", source: "product", target: "size", port: "next" }, { id: "d", source: "size", target: "done", port: "next" }] } };
const product = "11111111-1111-4111-8111-111111111111", { key } = orderFields("order");
function setup(collection = false) {
  const configured = structuredClone(version);
  if (collection) configured.collectionPolicy = { version: 1, revision: 1, scopes: [{ versionId: "v", flowId: "order", domain: "order", mode: "collection_only", profileFields: [] }] };
  const definitions = compileVisualProcesses(configured);
  let price = 25;
  const env: Environment = { mode: "test", now: 10, definitions, startableVersionIds: new Set(["v"]), tools: [orderToolPolicy()], promptTtlMs: 1000,
    serverFacts: () => ({ [key("productName")]: "Product", [key("productTypeId")]: "none", [key("unitAmount")]: price, [key("currency")]: "EUR", [key("quantity")]: 1, [key("options")]: '{"size":"M"}' }) };
  const message = "Order Product M for Example Customer +355691234567 Tirane Example address";
  const event = { id: "start", businessId: "b", conversationId: "c", actor: "customer" as const, message };
  const values = { [key("productId")]: product, size: "M", ...(collection ? {} : { customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" }) };
  const first = transitionCustomer(initialSnapshot("b", "c", "test"), event, { revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: "order", versionId: "v", evidence: message,
    initialFacts: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence: message })) }] }, env);
  const id = first.state.focusId!, waitId = first.state.instances[id].wait!.id;
  const state = recordPresentation(first.state, [waitId], 10);
  const approve = () => transitionCustomer(state, { ...event, id: "approval", message: "Proceed" }, { revision: state.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: id, waitId, evidence: "Proceed" }] }, env);
  return { first, state, approve, id, changePrice: () => { price = 30; } };
}
it("preserves the authored options and prepares the order only after a delivered review", () => {
  const h = setup(); expect(h.first.actions).toEqual([]);
  const approved = h.approve();
  expect(approved.actions).toHaveLength(1);
  expect(approved.actions[0].input).toMatchObject({ productId: product, unitAmount: 25, currency: "EUR", quantity: 1, options: '{"size":"M"}', name: "Example Customer" });
});
it("invalidates an order approval when the current price changes", () => {
  const h = setup(); h.changePrice(); const next = h.approve();
  expect(next.actions).toEqual([]);
  expect(next.state.instances[h.id].wait?.presentedAt).toBeUndefined();
  expect(next.state.instances[h.id].facts[key("unitAmount")].value).toBe(30);
});
it("collection-only completes without requiring unconfigured profile fields or preparing an order", () => {
  const h = setup(true), result = h.approve();
  expect(result.actions).toEqual([]); expect(result.state.instances[h.id].status).toBe("completed");
  expect(result.state.instances[h.id].confirmedReviews).toHaveLength(1);
});
