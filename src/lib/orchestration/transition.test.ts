import { describe, expect, it } from "vitest";
import { initialSnapshot, type CustomerCommand, type ProcessDefinition, type Snapshot } from "./contracts";
import { authorizeDispatch, recordPresentation, transitionActionResult, transitionCustomer, transitionWaitEvent, type Environment } from "./transition";

// Synthetic configuration based on the observed registration failure. No real customer data.
const definition: ProcessDefinition = {
  id: "registration", versionId: "v1", businessId: "business-1", name: "Registration", purpose: "Register an organization",
  offerPolicy: "when_relevant", entry: "name",
  fields: [
    { id: "organization_name", subject: "organization", label: "Organization name", type: "text", required: true },
    { id: "registration_email", subject: "organization", label: "Registration email", type: "email", required: true },
  ],
  steps: [
    { id: "name", kind: "collect", fieldId: "organization_name", next: "email" },
    { id: "email", kind: "collect", fieldId: "registration_email", next: "confirm" },
    { id: "confirm", kind: "confirm", fieldIds: ["organization_name", "registration_email"], label: "Review registration", yes: "create", no: "cancelled" },
    { id: "create", kind: "effect", tool: "business.provision", toolVersion: 1, inputs: { name: "organization_name", email: "registration_email" }, next: "done", failed: "staff" },
    { id: "done", kind: "end", label: "Registration complete" },
    { id: "cancelled", kind: "end", label: "Registration declined" },
    { id: "staff", kind: "handoff", label: "Contact staff" },
  ],
};
function harness(overrides: Partial<Environment> = {}) {
  let serial = 0;
  const env: Environment = { mode: "test", now: 1000, definitions: [structuredClone(definition)], startableVersionIds: new Set(["v1"]),
    promptTtlMs: 60000, id: () => `id-${++serial}`,
    tools: [{ key: "business.provision", version: 1, effect: "write", approval: "required", allowed: true,
      inputs: [{ key: "name", type: "text", required: true }, { key: "email", type: "email", required: true }] }], ...overrides };
  const initial = initialSnapshot("business-1", "conversation-1", env.mode);
  function turn(state: Snapshot, message: string, commands: CustomerCommand[]) {
    return transitionCustomer(state, { id: `event-${++serial}`, businessId: state.businessId, conversationId: state.conversationId, message, actor: "customer" },
      { revision: state.revision, commands, needsClarification: false }, env);
  }
  function started() { return turn(initial, "Register my business", [{ kind: "start", initialFacts: [], definitionId: "registration", versionId: "v1", evidence: "Register my business" }]).state; }
  function reviewed() {
    const state = started();
    const id = state.focusId!;
    const result = turn(state, "Cosmetics Demo, demo@example.test", [{ kind: "facts", instanceId: id, values: [
      { fieldId: "organization_name", value: "Cosmetics Demo", evidence: "Cosmetics Demo" },
      { fieldId: "registration_email", value: "demo@example.test", evidence: "demo@example.test" },
    ] }]);
    return recordPresentation(result.state, [result.state.instances[id].wait!.id], env.now);
  }
  function approved() {
    const state = reviewed();
    return turn(state, "Go ahead", [{ kind: "approve", instanceId: state.focusId!, waitId: state.instances[state.focusId!].wait!.id, evidence: "Go ahead" }]);
  }
  return { initial, env, turn, started, reviewed, approved };
}

describe("generic process transitions", () => {
  it("registers with one email answer and a delivered confirmation, without an order intent", () => {
    const h = harness();
    let result = h.turn(h.initial, "I sell cosmetics", [{ kind: "offer", definitionId: "registration", versionId: "v1", evidence: "I sell cosmetics" }]);
    const offer = result.notices[0].targetId!;
    result.state = recordPresentation(result.state, [offer], h.env.now);
    result = h.turn(result.state, "Let's set it up", [{ kind: "accept_offer", initialFacts: [], offerId: offer, evidence: "Let's set it up" }]);
    const id = result.state.focusId!;
    result = h.turn(result.state, "Cosmetics Demo", [{ kind: "facts", instanceId: id, values: [{ fieldId: "organization_name", value: "Cosmetics Demo", evidence: "Cosmetics Demo" }] }]);
    expect(result.notices[0].field?.id).toBe("registration_email");
    result = h.turn(result.state, "demo@example.test", [{ kind: "facts", instanceId: id, values: [{ fieldId: "registration_email", value: "demo@example.test", evidence: "demo@example.test" }] }]);
    const waitId = result.state.instances[id].wait!.id;
    expect(result.notices[0].kind).toBe("approval");
    expect(result.state.instances[id].facts.organization_name.subject).toBe("organization");
    expect(Object.keys(result.state.instances[id].facts)).toEqual(["organization_name", "registration_email"]);
    result.state = recordPresentation(result.state, [waitId], h.env.now);
    result = h.turn(result.state, "What does this include?", []);
    expect(result.state.instances[id].wait?.id).toBe(waitId);
    result = h.turn(result.state, "Proceed with those details", [{ kind: "approve", instanceId: id, waitId, evidence: "Proceed with those details" }]);
    expect(result.actions).toHaveLength(1);
    const action = authorizeDispatch(result.state, id, result.actions[0].id, h.env);
    expect(action.input).toEqual({ name: "Cosmetics Demo", email: "demo@example.test" });
    result = transitionActionResult(result.state, { instanceId: id, actionId: action.id, status: "simulated", output: { invitation: "test-only" } }, h.env);
    expect(result.state.instances[id].status).toBe("completed");
    expect(result.state.instances[id].action?.status).toBe("simulated");
  });

  it("supports collection-only processes without an external action", () => {
    const collect: ProcessDefinition = { ...definition, id: "inquiry", steps: [definition.steps[0], { ...definition.steps[1], next: "done" } as ProcessDefinition["steps"][number], definition.steps[4]] };
    const h = harness({ definitions: [collect], tools: [] });
    let result = h.turn(h.initial, "Send my inquiry", [{ kind: "start", initialFacts: [], definitionId: "inquiry", versionId: "v1", evidence: "Send my inquiry" }]);
    result = h.turn(result.state, "Cosmetics Demo demo@example.test", [{ kind: "facts", instanceId: result.state.focusId!, values: [
      { fieldId: "organization_name", value: "Cosmetics Demo", evidence: "Cosmetics Demo" },
      { fieldId: "registration_email", value: "demo@example.test", evidence: "demo@example.test" },
    ] }]);
    expect(result.notices[0].kind).toBe("completed");
    expect(result.actions).toEqual([]);
  });

  it("keeps two requests with identical data distinct", () => {
    const h = harness();
    const a = h.approved();
    let b = h.turn(a.state, "Register another business", [{ kind: "start", initialFacts: [], definitionId: "registration", versionId: "v1", evidence: "Register another business" }]);
    const id = b.state.focusId!;
    b = h.turn(b.state, "Cosmetics Demo demo@example.test", [{ kind: "facts", instanceId: id, values: [
      { fieldId: "organization_name", value: "Cosmetics Demo", evidence: "Cosmetics Demo" },
      { fieldId: "registration_email", value: "demo@example.test", evidence: "demo@example.test" },
    ] }]);
    const waitId = b.state.instances[id].wait!.id;
    b.state = recordPresentation(b.state, [waitId], h.env.now);
    b = h.turn(b.state, "Confirm", [{ kind: "approve", instanceId: id, waitId, evidence: "Confirm" }]);
    expect(b.actions[0].id).not.toBe(a.actions[0].id);
    expect(b.actions[0].inputDigest).toBe(a.actions[0].inputDigest);
    expect(Object.keys(b.state.instances)).toHaveLength(2);
  });

  it("keeps a pending collect field through an informational turn with no process commands", () => {
    const h = harness();
    const state = h.started();
    const id = state.focusId!, wait = structuredClone(state.instances[id].wait);
    const next = h.turn(state, "How does this work?", []);
    expect(next.state.instances[id].wait).toEqual(wait);
    expect(next.state.instances[id].facts).toEqual({});
    expect(next.actions).toEqual([]);
  });

  it("retains facts and the pending target through suspension and resumption", () => {
    const h = harness();
    const state = h.reviewed();
    const id = state.focusId!;
    let result = h.turn(state, "Pause this", [{ kind: "suspend", instanceId: id, evidence: "Pause this" }]);
    expect(result.state.instances[id].status).toBe("suspended");
    result = h.turn(result.state, "Continue", [{ kind: "resume", instanceId: id, evidence: "Continue" }]);
    expect(result.state.instances[id].facts).toEqual(state.instances[id].facts);
    expect(result.state.instances[id].wait).toEqual(state.instances[id].wait);
  });

  it("invalidates the old approval after a correction and presents a new target", () => {
    const h = harness();
    const state = h.reviewed();
    const id = state.focusId!;
    const oldWait = state.instances[id].wait!.id;
    const corrected = h.turn(state, "Use new@example.test", [{ kind: "facts", instanceId: id, values: [{ fieldId: "registration_email", value: "new@example.test", evidence: "new@example.test" }] }]);
    expect(corrected.state.instances[id].wait!.id).not.toBe(oldWait);
    expect(corrected.state.instances[id].wait!.presentedAt).toBeUndefined();
    expect(() => h.turn(corrected.state, "Confirm", [{ kind: "approve", instanceId: id, waitId: oldWait, evidence: "Confirm" }])).toThrow("invalid_approval_target");
    expect(corrected.actions).toEqual([]);
  });

  it.each(["before", "after"])("does not authorize correction and approval of old data in one event (%s)", order => {
    const h = harness();
    const state = h.reviewed();
    const id = state.focusId!;
    const facts: CustomerCommand = { kind: "facts", instanceId: id, values: [{ fieldId: "registration_email", value: "new@example.test", evidence: "new@example.test" }] };
    const approval: CustomerCommand = { kind: "approve", instanceId: id, waitId: state.instances[id].wait!.id, evidence: "Confirm" };
    expect(() => h.turn(state, "Confirm, use new@example.test", order === "before" ? [facts, approval] : [approval, facts])).toThrow();
    expect(state.instances[id].facts.registration_email.value).toBe("demo@example.test");
  });

  it.each(["unpresented", "expired", "wrong-target"])("rejects %s confirmation", reason => {
    const h = harness();
    const state = h.reviewed();
    const id = state.focusId!;
    if (reason === "unpresented") delete state.instances[id].wait!.presentedAt;
    if (reason === "expired") h.env.now += 60001;
    expect(() => h.turn(state, "Yes", [{ kind: "approve", instanceId: id, waitId: reason === "wrong-target" ? "other" : state.instances[id].wait!.id, evidence: "Yes" }])).toThrow("invalid_approval_target");
  });

  it("rejects stale observations, foreign tenants and hallucinated evidence", () => {
    const h = harness();
    const event = { id: "event", businessId: "business-1", conversationId: "conversation-1", message: "hello", actor: "customer" as const };
    expect(() => transitionCustomer(h.initial, event, { revision: 8, commands: [], needsClarification: false }, h.env)).toThrow("stale_observation");
    expect(() => transitionCustomer(h.initial, { ...event, businessId: "foreign" }, { revision: 0, commands: [], needsClarification: false }, h.env)).toThrow("event_scope_mismatch");
    expect(() => h.turn(h.initial, "hello", [{ kind: "start", initialFacts: [], definitionId: "registration", versionId: "v1", evidence: "register" }])).toThrow("invalid_evidence");
  });

  it("rejects an invalid field atomically without losing previous progress", () => {
    const h = harness();
    const state = h.started();
    const before = structuredClone(state);
    expect(() => h.turn(state, "Demo invalid-email", [{ kind: "facts", instanceId: state.focusId!, values: [
      { fieldId: "organization_name", value: "Demo", evidence: "Demo" },
      { fieldId: "registration_email", value: "invalid-email", evidence: "invalid-email" },
    ] }])).toThrow("invalid_fact");
    expect(state).toEqual(before);
  });

  it("blocks dispatch when permissions are revoked or confirmation expires", () => {
    const h = harness();
    const result = h.approved();
    const action = result.actions[0];
    h.env.tools[0].allowed = false;
    expect(() => authorizeDispatch(result.state, action.instanceId, action.id, h.env)).toThrow("tool_unavailable");
    h.env.tools[0].allowed = true;
    h.env.now += 60001;
    expect(() => authorizeDispatch(result.state, action.instanceId, action.id, h.env)).toThrow("approval_required");
  });

  it("keeps uncertain effects waiting for reconciliation without preparing a retry", () => {
    const h = harness();
    const result = h.approved();
    const action = result.actions[0];
    const unknown = transitionActionResult(result.state, { instanceId: action.instanceId, actionId: action.id, status: "unknown", output: {} }, h.env);
    expect(unknown.actions).toEqual([]);
    expect(unknown.state.instances[action.instanceId].status).toBe("waiting_effect");
    expect(() => authorizeDispatch(unknown.state, action.instanceId, action.id, h.env)).toThrow("action_not_dispatchable");
    expect(() => h.turn(unknown.state, "Try again", [{ kind: "cancel", instanceId: action.instanceId, evidence: "Try again" }])).toThrow("instance_not_editable");
    const recovered = transitionActionResult(unknown.state, { instanceId: action.instanceId, actionId: action.id, status: "succeeded", output: {} }, h.env);
    expect(recovered.state.instances[action.instanceId].status).toBe("completed");
  });

  it("correlates a durable wait and distinguishes expiry from completion", () => {
    const waiting: ProcessDefinition = { ...definition, fields: [], entry: "timer", steps: [
      { id: "timer", kind: "wait", eventType: "callback", timeoutMs: 5000, next: "done", expired: "staff" }, definition.steps[4], definition.steps[6],
    ] };
    const h = harness({ definitions: [waiting] });
    const state = h.started();
    const id = state.focusId!;
    const target = { instanceId: id, waitId: state.instances[id].wait!.id, eventType: "callback" };
    expect(() => transitionWaitEvent(state, { ...target, waitId: "other" }, h.env)).toThrow("unexpected_wait_event");
    expect(transitionWaitEvent(state, target, h.env).state.instances[id].status).toBe("completed");
    h.env.now += 5000;
    expect(transitionWaitEvent(state, target, h.env).state.instances[id].status).toBe("handoff");
  });

  it("re-evaluates an earlier condition after a correction instead of bypassing new requirements", () => {
    const shipping: ProcessDefinition = { ...definition, entry: "delivery", fields: [
      { id: "delivery", subject: "order", label: "Delivery", type: "boolean", required: true },
      { id: "address", subject: "order", label: "Address", type: "text", required: true },
    ], steps: [
      { id: "delivery", kind: "collect", fieldId: "delivery", next: "route" },
      { id: "route", kind: "condition", fieldId: "delivery", operator: "equals", value: true, yes: "address", no: "review" },
      { id: "address", kind: "collect", fieldId: "address", next: "review" },
      { id: "review", kind: "confirm", fieldIds: ["delivery"], label: "Review", yes: "done", no: "cancelled" }, definition.steps[4], definition.steps[5],
    ] };
    const h = harness({ definitions: [shipping] });
    let state = h.started();
    const id = state.focusId!;
    state = h.turn(state, "Pickup", [{ kind: "facts", instanceId: id, values: [{ fieldId: "delivery", value: false, evidence: "Pickup" }] }]).state;
    expect(state.instances[id].stepId).toBe("review");
    const corrected = h.turn(state, "Please deliver it instead", [{ kind: "facts", instanceId: id, values: [{ fieldId: "delivery", value: true, evidence: "deliver it instead" }] }]);
    expect(corrected.notices[0].field?.id).toBe("address");
    expect(corrected.actions).toEqual([]);
  });

  it("does not activate a process from an undelivered offer", () => {
    const h = harness();
    const offered = h.turn(h.initial, "Cosmetics", [{ kind: "offer", definitionId: "registration", versionId: "v1", evidence: "Cosmetics" }]);
    expect(() => h.turn(offered.state, "Yes", [{ kind: "accept_offer", offerId: offered.notices[0].targetId!, evidence: "Yes", initialFacts: [] }])).toThrow("offer_not_presented_or_expired");
  });

  it("keeps a second delivered receipt idempotent and ignores a replaced target", () => {
    const h = harness();
    const state = h.reviewed();
    const waitId = state.instances[state.focusId!].wait!.id;
    expect(recordPresentation(state, [waitId, "obsolete"], h.env.now)).toEqual(state);
  });

  it("rejects a simulated effect receipt in live mode", () => {
    const h = harness();
    const result = h.approved();
    const action = result.actions[0];
    expect(() => transitionActionResult({ ...result.state, mode: "live" }, { instanceId: action.instanceId, actionId: action.id, status: "simulated", output: {} }, { ...h.env, mode: "live" })).toThrow("simulation_in_live_mode");
  });

  it.each([true, false])("handles an explicit field skip with required=%s", required => {
    const inquiry: ProcessDefinition = { ...definition, fields: [{ ...definition.fields[0], required }], steps: [
      { ...definition.steps[0], next: "done" } as ProcessDefinition["steps"][number], definition.steps[4],
    ] };
    const h = harness({ definitions: [inquiry] });
    let state = h.started();
    const id = state.focusId!, waitId = state.instances[id].wait!.id;
    state = recordPresentation(state, [waitId], h.env.now);
    const skip = () => h.turn(state, "I'd rather leave this blank", [{ kind: "skip_field", instanceId: id, waitId, evidence: "leave this blank" }]);
    if (required) expect(skip).toThrow("field_not_skippable");
    else {
      const result = skip();
      expect(result.state.instances[id].status).toBe("completed");
      expect(result.state.instances[id].facts).toEqual({});
      expect(result.state.instances[id].skippedFields?.organization_name.evidence).toBe("leave this blank");
    }
  });
  it("applies stored profile memory on start without requiring it in the current message", () => {
    const lead: ProcessDefinition = { id: "lead", versionId: "v1", businessId: "business-1", name: "Lead", purpose: "Collect a contact", offerPolicy: "on_request", entry: "name",
      fields: [{ id: "customer_name", subject: "customer", label: "Name", type: "text", required: true, min: 2, max: 120 }, { id: "note", subject: "customer", label: "Note", type: "text", required: true }],
      steps: [{ id: "name", kind: "collect", fieldId: "customer_name", next: "note" }, { id: "note", kind: "collect", fieldId: "note", next: "done" }, { id: "done", kind: "end", label: "Saved" }] };
    const h = harness({ definitions: [lead] });
    const state = { ...h.initial, profileMemory: { name: { value: "Ana Demo", type: "text" as const } } };
    const result = h.turn(state, "I want to leave a request", [{ kind: "start", definitionId: "lead", versionId: "v1", evidence: "leave a request", initialFacts: [] }]);
    const id = result.state.focusId!;
    expect(result.state.instances[id].facts.customer_name).toMatchObject({ value: "Ana Demo", evidence: "profile_memory" });
    expect(result.state.instances[id].wait?.fieldId).toBe("note");
  });
  it("does not overwrite an already collected customer field with profile memory", () => {
    const lead: ProcessDefinition = { id: "lead", versionId: "v1", businessId: "business-1", name: "Lead", purpose: "Collect a contact", offerPolicy: "on_request", entry: "name",
      fields: [{ id: "customer_name", subject: "customer", label: "Name", type: "text", required: true, min: 2, max: 120 }, { id: "note", subject: "customer", label: "Note", type: "text", required: true }],
      steps: [{ id: "name", kind: "collect", fieldId: "customer_name", next: "note" }, { id: "note", kind: "collect", fieldId: "note", next: "done" }, { id: "done", kind: "end", label: "Saved" }] };
    const h = harness({ definitions: [lead] });
    const state = { ...h.initial, profileMemory: { name: { value: "Old name", type: "text" as const } } };
    const result = h.turn(state, "My name is Current name", [{ kind: "start", definitionId: "lead", versionId: "v1", evidence: "Current name",
      initialFacts: [{ fieldId: "customer_name", value: "Current name", evidence: "Current name" }] }]);
    const id = result.state.focusId!;
    expect(result.state.instances[id].facts.customer_name).toMatchObject({ value: "Current name", evidence: "Current name" });
    expect(result.state.instances[id].wait?.fieldId).toBe("note");
  });
});
