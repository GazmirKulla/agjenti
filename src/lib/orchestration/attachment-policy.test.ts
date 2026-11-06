import { expect, it } from "vitest";
import { initialSnapshot, type ProcessDefinition } from "./contracts";
import { transitionCustomer, recordPresentation, type Environment } from "./transition";
import { digest } from "./definition";
const definition: ProcessDefinition = { id: "photo", versionId: "v", businessId: "b", name: "Photo", purpose: "Collect a photo", offerPolicy: "on_request", entry: "photo",
  fields: [{ id: "image", label: "Photo", subject: "request", type: "photo", required: true }],
  steps: [{ id: "photo", kind: "collect", fieldId: "image", next: "done" }, { id: "done", kind: "end", label: "Collected" }] };
const event = { id: "start", businessId: "b", conversationId: "c", message: "Start", actor: "customer" as const };
function setup() {
  const env: Environment = { mode: "test", now: 10, promptTtlMs: 1000, definitions: [definition], startableVersionIds: new Set(["v"]), tools: [] };
  const state = transitionCustomer(initialSnapshot("b", "c", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "photo", versionId: "v", initialFacts: [], evidence: "Start" }] }, env).state;
  return { env, state, id: state.focusId! };
}
it("accepts a verified attachment only for an already delivered photo prompt", () => {
  const h = setup(); h.env.photoReceived = true;
  const observation = { revision: h.state.revision, needsClarification: false, commands: [] };
  expect(transitionCustomer(h.state, { ...event, id: "attachment", message: "" }, observation, h.env).state.instances[h.id].status).toBe("waiting_input");
  const delivered = recordPresentation(h.state, [h.state.instances[h.id].wait!.id], 10);
  const result = transitionCustomer(delivered, { ...event, id: "attachment", message: "" }, { ...observation, revision: delivered.revision }, h.env);
  expect(result.state.instances[h.id].status).toBe("completed");
  expect(result.state.instances[h.id].facts.image).toMatchObject({ value: true, eventId: "attachment", evidence: "attachment:attachment" });
});
it("refuses model-supplied photo claims", () => {
  const h = setup();
  expect(() => transitionCustomer(h.state, event, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: h.id, values: [{ fieldId: "image", value: true, evidence: "Start" }] }] }, h.env)).toThrow("invalid_fact");
});
it("never assigns one attachment to two pending photo requests", () => {
  const h = setup();
  const second = transitionCustomer(h.state, { ...event, id: "second" }, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "start", definitionId: "photo", versionId: "v", initialFacts: [], evidence: "Start" }] }, h.env).state;
  const state = recordPresentation(second, Object.values(second.instances).map(i => i.wait!.id), 10);
  const next = transitionCustomer(state, { ...event, id: "attachment", message: "" }, { revision: state.revision, needsClarification: false, commands: [] }, { ...h.env, photoReceived: true });
  expect(Object.values(next.state.instances).every(i => !i.facts.image)).toBe(true);
});
it("a changed execution policy blocks progress but still permits cancellation", () => {
  const h = setup(); h.env.definitions = [{ ...definition, policyKey: digest({ collectionOnly: true }) }];
  expect(() => transitionCustomer(h.state, event, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "suspend", instanceId: h.id, evidence: "Start" }] }, h.env)).toThrow("process_policy_changed");
  const cancelled = transitionCustomer(h.state, event, { revision: h.state.revision, needsClarification: false,
    commands: [{ kind: "cancel", instanceId: h.id, evidence: "Start" }] }, h.env);
  expect(cancelled.state.instances[h.id].status).toBe("cancelled");
});
