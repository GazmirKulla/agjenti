import { expect, it } from "vitest";
import { compileLinearProcess, linearProcessVersion } from "./linear-definition";
import { initialSnapshot } from "./contracts";
import { orderFields, orderToolPolicy } from "./order-definition";
import { recordPresentation, transitionCustomer, type Environment } from "./transition";

const product = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const version = linearProcessVersion({ id: "version", businessId: "business", workflowId: "workflow", name: "Personalized product", productIds: [product], steps: [
    { key: "size", kind: "choice", options: ["S", "M", "L"], required: true },
    { key: "artwork", kind: "photo", required: true },
    { key: "delivery", kind: "customer", required: true },
  ] });
  const definition = compileLinearProcess(version), { key } = orderFields(definition.id);
  const env: Environment = { mode: "test", now: 10, promptTtlMs: 1000, definitions: [definition], startableVersionIds: new Set([version.id]), tools: [orderToolPolicy()],
    serverFacts: () => ({ [key("productName")]: "Custom product", [key("productTypeId")]: "none", [key("unitAmount")]: 20, [key("currency")]: "EUR", [key("quantity")]: 1, [key("options")]: '{"size":"M","artwork":true}' }) };
  const event = { id: "event", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Custom product M, Example Customer, +355691234567, Tirane, Example address" };
  const values = { [key("productId")]: product, size: "M", customer_name: "Example Customer", customer_phone: "+355691234567", customer_city: "Tirane", customer_address: "Example address" };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: definition.id, versionId: version.id, evidence: event.message,
      initialFacts: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence: event.message })) }] }, env);
  return { first, env, event, definition };
}
it("preserves product choices and the verified photo step before reviewing a linear order", () => {
  const { first, env, event } = fixture(), id = first.state.focusId!;
  expect(first.state.instances[id].wait?.fieldId).toBe("artwork");
  expect(first.actions).toEqual([]);
  const state = recordPresentation(first.state, [first.state.instances[id].wait!.id], 10);
  const photo = transitionCustomer(state, { ...event, id: "photo", message: "Attached" }, { revision: state.revision, commands: [], needsClarification: false }, { ...env, photoReceived: true });
  expect(photo.state.instances[id].status).toBe("waiting_approval");
  expect(photo.actions).toEqual([]);
  const shown = recordPresentation(photo.state, [photo.state.instances[id].wait!.id], 10);
  const approved = transitionCustomer(shown, { ...event, id: "confirm", message: "Proceed" }, { revision: shown.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: id, waitId: shown.instances[id].wait!.id, evidence: "Proceed" }] }, env);
  expect(approved.actions).toHaveLength(1);
  expect(approved.actions[0]).toMatchObject({ tool: "order.create", input: { productId: product, unitAmount: 20, options: '{"size":"M","artwork":true}' } });
});
it("retains configured choice constraints instead of accepting arbitrary option text", () => {
  const { first, env, event } = fixture(), id = first.state.focusId!;
  expect(() => transitionCustomer(first.state, { ...event, id: "correct", message: "XL" }, { revision: first.state.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: "size", value: "XL", evidence: "XL" }] }] }, env)).toThrow();
});
