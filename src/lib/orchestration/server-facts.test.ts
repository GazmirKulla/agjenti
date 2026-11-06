import { expect, it } from "vitest";
import { initialSnapshot, type ProcessDefinition } from "./contracts";
import { recordPresentation, transitionCustomer, type Environment } from "./transition";
const definition: ProcessDefinition = { id: "request", versionId: "v", businessId: "b", name: "Request", purpose: "Request service", offerPolicy: "on_request", entry: "review",
  fields: [{ id: "terms", subject: "service", label: "Current terms", type: "text", required: true, source: "server" }],
  steps: [{ id: "review", kind: "confirm", fieldIds: ["terms"], label: "Confirm request", yes: "done", no: "cancel" }, { id: "done", kind: "end", label: "Done" }, { id: "cancel", kind: "end", label: "Cancelled" }] };
const event = { id: "e", businessId: "b", conversationId: "c", actor: "customer" as const, message: "Request service" };
function setup() {
  let terms = "30 minutes";
  const env: Environment = { mode: "test", now: 10, definitions: [definition], startableVersionIds: new Set(["v"]), tools: [], promptTtlMs: 1000, serverFacts: () => ({ terms }) };
  const result = transitionCustomer(initialSnapshot("b", "c", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "request", versionId: "v", initialFacts: [], evidence: event.message }] }, env);
  const id = result.state.focusId!, waitId = result.state.instances[id].wait!.id;
  return { env, id, waitId, state: recordPresentation(result.state, [waitId], 11), change: () => { terms = "45 minutes"; } };
}
it("replaces a delivered review when current server terms change and requires another approval", () => {
  const h = setup(); h.change(); h.env.now = 12;
  const result = transitionCustomer(h.state, { ...event, id: "approval", message: "Proceed" }, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: h.waitId, evidence: "Proceed" }] }, h.env);
  expect(result.state.instances[h.id].status).toBe("waiting_approval");
  expect(result.state.instances[h.id].facts.terms.value).toBe("45 minutes");
  expect(result.state.instances[h.id].wait!.id).not.toBe(h.waitId);
  expect(result.state.instances[h.id].wait!.presentedAt).toBeUndefined();
  expect(result.actions).toEqual([]);
});
it("refuses customer-supplied values for server fields", () => {
  const h = setup();
  expect(() => transitionCustomer(h.state, { ...event, message: "free" }, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: h.id, values: [{ fieldId: "terms", value: "free", evidence: "free" }] }] }, h.env)).toThrow("invalid_fact");
  expect(h.state.instances[h.id].facts.terms.value).toBe("30 minutes");
});
it("validates the approval target before refreshing changed terms", () => {
  const h = setup(); h.change(); h.env.now = 12;
  expect(() => transitionCustomer(h.state, { ...event, message: "Proceed" }, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: "wrong", evidence: "Proceed" }] }, h.env)).toThrow("invalid_approval_target");
});
it("does not require server fields from an unrelated branch", () => {
  const h = setup();
  h.env.definitions = [{ ...definition, fields: [...definition.fields, { id: "other", subject: "other", label: "Other terms", type: "text", source: "server", required: true }] }];
  h.env.now = 12;
  const result = transitionCustomer(h.state, { ...event, message: "Proceed" }, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: h.id, waitId: h.waitId, evidence: "Proceed" }] }, h.env);
  expect(result.state.instances[h.id].status).toBe("completed");
});
