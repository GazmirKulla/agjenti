import { expect, it } from "vitest";
import { normalizeVisualDraft } from "@/lib/workflows/visual/model";
import type { VisualGraphV2, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";
import { compileVisualProcesses, visualNodeForStep } from "./visual-definition";
import { initialSnapshot } from "./contracts";
import { transitionCustomer, type Environment } from "./transition";

function node(id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode {
  return { id, kind, label: id, config, position: { x: 0, y: 0 } };
}
export function registrationVersion(): VisualVersion & { graph: VisualGraphV2 } {
  return { id: "v1", businessId: "business", createdAt: "2026-11-05", graph: {
    version: 2, name: "Customer processes", flows: [{ id: "registration", label: "Registration", purpose: "Register a business", offerPolicy: "when_relevant", kind: "custom", entryNodeId: "name", nodeIds: ["name", "email", "confirm"] }],
    nodes: [node("start", "start"), node("name", "collect", { fieldKey: "organization_name", fieldType: "text", subject: "organization", prompt: "Business name?" }),
      node("email", "collect", { fieldKey: "registration_email", fieldType: "email", subject: "organization", required: false, prompt: "Email?" }),
      node("confirm", "confirm", { prompt: "Review these details" }), node("done", "end")],
    edges: [{ id: "s", source: "start", target: "done", port: "next" }, { id: "n", source: "name", target: "email", port: "next" },
      { id: "e", source: "email", target: "confirm", port: "next" }, { id: "y", source: "confirm", target: "done", port: "yes" }, { id: "no", source: "confirm", target: "name", port: "no" }],
  } };
}
it("round trips configured purpose, subject and optionality through the existing editor format", () => {
  const version = registrationVersion();
  version.graph = normalizeVisualDraft(version.graph) as VisualGraphV2;
  const [definition] = compileVisualProcesses(version);
  expect(definition).toMatchObject({ id: "registration", versionId: "v1", purpose: "Register a business", offerPolicy: "when_relevant" });
  expect(definition.fields).toEqual([
    { id: "organization_name", label: "name", type: "text", subject: "organization", required: true },
    { id: "registration_email", label: "email", type: "email", subject: "organization", required: false },
  ]);
});
it("executes the editor's actual custom fields once and traces each visited node", () => {
  const steps: string[] = [];
  const env: Environment = { mode: "test", now: 1, definitions: compileVisualProcesses(registrationVersion()), startableVersionIds: new Set(["v1"]), tools: [], promptTtlMs: 60000, onStep: s => steps.push(s.stepId) };
  const result = transitionCustomer(initialSnapshot("business", "conversation", "test"), { id: "event", businessId: "business", conversationId: "conversation", actor: "customer", message: "Register Cosmetics Demo demo@example.test" }, {
    revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: "registration", versionId: "v1", evidence: "Register", initialFacts: [
      { fieldId: "organization_name", value: "Cosmetics Demo", evidence: "Cosmetics Demo" }, { fieldId: "registration_email", value: "demo@example.test", evidence: "demo@example.test" },
    ] }],
  }, env);
  expect(steps).toEqual(["name", "email", "confirm"]);
  expect(result.notices.map(n => n.kind)).toEqual(["approval"]);
  expect(result.state.instances[result.state.focusId!].facts.organization_name.subject).toBe("organization");
});
it("does not invent an adapter for unsupported capabilities", () => {
  const version = registrationVersion();
  version.graph.nodes[1] = node("name", "product");
  expect(() => compileVisualProcesses(version)).toThrow("process_graph_adapter_pending");
});
it("rejects incompatible subjects for a repeated field instead of silently aliasing them", () => {
  const version = registrationVersion();
  version.graph.nodes[2].config = { ...version.graph.nodes[1].config, subject: "person" };
  expect(() => compileVisualProcesses(version)).toThrow("conflicting_field_schema");
});
it("validates semantic branch identity and evidence without treating a branch as effect approval", () => {
  const version = registrationVersion();
  version.graph.nodes.push(node("support", "condition", { condition: "intent_support" }), node("staff", "handoff"));
  version.graph.flows.push({ id: "support_flow", label: "Staff assistance", kind: "support", entryNodeId: "support", nodeIds: ["support", "staff"] });
  version.graph.edges.push({ id: "sy", source: "support", target: "staff", port: "yes" }, { id: "sn", source: "support", target: "done", port: "no" });
  const definitions = compileVisualProcesses(version);
  const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set(["v1"]), tools: [], promptTtlMs: 60000 };
  const state = initialSnapshot("business", "conversation", "test");
  const event = { id: "event", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Please let me speak to your team" };
  const observation = { revision: 0, needsClarification: false, commands: [{ kind: "start" as const, definitionId: "support_flow", versionId: "v1", evidence: event.message, initialFacts: [] }],
    conditions: [{ definitionId: "support_flow", versionId: "v1", instanceId: null, stepId: "support", outcome: "yes" as const, evidence: event.message }] };
  const result = transitionCustomer(state, event, observation, env);
  expect(result.notices.map(n => n.kind)).toEqual(["handoff"]);
  expect(result.actions).toEqual([]);
  expect(() => transitionCustomer(state, event, { ...observation, conditions: [] }, env)).toThrow("semantic_condition_unresolved");
  expect(() => transitionCustomer(state, event, { ...observation, conditions: [{ ...observation.conditions[0], stepId: "name" }] }, env)).toThrow("invalid_condition_target");
  expect(() => transitionCustomer(state, event, { ...observation, conditions: [{ ...observation.conditions[0], evidence: "invented" }] }, env)).toThrow("invalid_evidence");
  expect(state.instances).toEqual({});
});

it("expands the existing booking node into collection, review and an approved domain effect", async () => {
  const { bookingFields, bookingServerValues, bookingToolPolicy } = await import("./booking-definition");
  const { recordPresentation } = await import("./transition");
  const version = registrationVersion();
  version.graph.nodes = [node("start", "start"), node("book", "booking"), node("done", "end")];
  version.graph.flows = [{ id: "reservation", label: "Reservation", kind: "booking", entryNodeId: "book", nodeIds: ["book"] }];
  version.graph.edges = [{ id: "s", source: "start", target: "done", port: "next" }, { id: "b", source: "book", target: "done", port: "next" }];
  const definitions = compileVisualProcesses(version), { key } = bookingFields("book");
  expect(visualNodeForStep(version, key("review"))).toBe("book");
  expect(visualNodeForStep(version, key("create"))).toBe("book");
  expect(visualNodeForStep(version, "done")).toBe("done");
  const terms = { serviceId: "11111111-1111-4111-8111-111111111111", serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 10, timezone: "UTC", confirmationMode: "manual" as const };
  const values = { serviceId: terms.serviceId, date: "2026-12-01", time: "10:00", name: "Test Customer", contact: "test@example.test" };
  const message = "Book Consultation on December 1 at 10:00 for Test Customer test@example.test";
  const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set([version.id]), tools: [bookingToolPolicy(true)], promptTtlMs: 60000,
    serverFacts: () => bookingServerValues("book", terms) };
  const event = { id: "e", businessId: "business", conversationId: "conversation", message, actor: "customer" as const };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "reservation", versionId: version.id, evidence: message,
      initialFacts: Object.entries(values).map(([name, value]) => ({ fieldId: key(name), value, evidence: message })) }] }, env);
  expect(first.actions).toEqual([]);
  const id = first.state.focusId!, waitId = first.state.instances[id].wait!.id;
  expect(first.state.instances[id].status).toBe("waiting_approval");
  const presented = recordPresentation(first.state, [waitId], 2);
  const approved = transitionCustomer(presented, { ...event, id: "a", message: "Proceed" }, { revision: presented.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: id, waitId, evidence: "Proceed" }] }, { ...env, now: 3 });
  expect(approved.actions).toHaveLength(1);
  expect(approved.actions[0]).toMatchObject({ tool: "booking.create", input: { ...terms, ...values } });
  version.collectionPolicy = { version: 1, revision: 1, scopes: [{ versionId: version.id, flowId: "reservation", domain: "booking", mode: "collection_only", profileFields: [] }] };
  expect(() => compileVisualProcesses(version)).toThrow("process_graph_adapter_pending");
});
