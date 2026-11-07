import { expect, it } from "vitest";
import type { VisualNode, VisualVersion } from "@/lib/workflows/visual/types";
import { processPreparedRequest } from "./prepared-request";
import { compileVisualProcesses } from "./visual-definition";
import { bookingFields, bookingServerValues, bookingToolPolicy } from "./booking-definition";
import { initialSnapshot } from "./contracts";
import { recordPresentation, transitionCustomer, type Environment } from "./transition";

function node(id: string, kind: VisualNode["kind"]): VisualNode {
  return { id, kind, label: id, config: {}, position: { x: 0, y: 0 } };
}
function bookingVersion(): VisualVersion {
  return { id: "v1", businessId: "business", createdAt: "2026-11-05",
    collectionPolicy: { version: 1, revision: 1, scopes: [{ versionId: "v1", flowId: "reservation", domain: "booking", mode: "collection_only", profileFields: [] }] },
    graph: { version: 2, name: "Customer processes",
      nodes: [node("start", "start"), node("book", "booking"), node("done", "end")],
      flows: [{ id: "reservation", label: "Reservation", kind: "booking", entryNodeId: "book", nodeIds: ["book"] }],
      edges: [{ id: "s", source: "start", target: "done", port: "next" }, { id: "b", source: "book", target: "done", port: "next" }] } };
}

it("projects a collection-only booking as evidence, never as transaction authority", () => {
  const version = bookingVersion(), definitions = compileVisualProcesses(version), { key } = bookingFields("book");
  const terms = { serviceId: "11111111-1111-4111-8111-111111111111", serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 10, timezone: "UTC", confirmationMode: "manual" as const };
  const values = { serviceId: terms.serviceId, date: "2026-12-01", time: "10:00", name: "Test Customer", contact: "test@example.test" };
  const message = "Book Consultation on December 1 at 10:00 for Test Customer test@example.test";
  const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set([version.id]), tools: [bookingToolPolicy(true)], promptTtlMs: 60000,
    serverFacts: () => bookingServerValues("book", terms) };
  const event = { id: "e", businessId: "business", conversationId: "conversation", message, actor: "customer" as const };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "reservation", versionId: version.id, evidence: message,
      initialFacts: Object.entries(values).map(([name, value]) => ({ fieldId: key(name), value, evidence: message })) }] }, env);
  const id = first.state.focusId!, instance = first.state.instances[id];
  const projection = processPreparedRequest(instance, definitions[0], version, 1);
  expect(projection).toMatchObject({
    domain: "booking", entity: { id: terms.serviceId, kind: "service", name: terms.serviceName },
    missingFields: [], validation: "valid", review: "review_requested", handoff: "not_handed_off", transaction: "not_executed_by_agent",
  });
  expect(processPreparedRequest(instance, { ...definitions[0], collection: undefined }, version, 1)).toBeUndefined();
  expect(processPreparedRequest(instance, { ...definitions[0], policyKey: "a".repeat(64) }, version, 1)).toBeUndefined();
  const presented = recordPresentation(first.state, [instance.wait!.id], 2);
  const approved = transitionCustomer(presented, { ...event, id: "a", message: "Proceed" }, { revision: presented.revision, needsClarification: false,
    commands: [{ kind: "approve", instanceId: id, waitId: presented.instances[id].wait!.id, evidence: "Proceed" }] }, { ...env, now: 3 });
  expect(approved.actions).toEqual([]);
  expect(processPreparedRequest(approved.state.instances[id], definitions[0], version, 3)).toMatchObject({
    review: "customer_confirmed", validation: "valid", transaction: "not_executed_by_agent",
  });
});

it("does not keep a booking confirmed after the collected time changes", () => {
  const version = bookingVersion(), definitions = compileVisualProcesses(version), { key } = bookingFields("book");
  const terms = { serviceId: "11111111-1111-4111-8111-111111111111", serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 10, timezone: "UTC", confirmationMode: "manual" as const };
  const values = { serviceId: terms.serviceId, date: "2026-12-01", time: "10:00", name: "Test Customer", contact: "test@example.test" };
  const message = "Book Consultation on December 1 at 10:00 for Test Customer test@example.test";
  const env: Environment = { mode: "test", now: 1, definitions, startableVersionIds: new Set([version.id]), tools: [bookingToolPolicy(true)], promptTtlMs: 60000,
    serverFacts: () => bookingServerValues("book", terms) };
  const event = { id: "e", businessId: "business", conversationId: "conversation", message, actor: "customer" as const };
  const first = transitionCustomer(initialSnapshot("business", "conversation", "test"), event, { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "reservation", versionId: version.id, evidence: message,
      initialFacts: Object.entries(values).map(([name, value]) => ({ fieldId: key(name), value, evidence: message })) }] }, env);
  const id = first.state.focusId!;
  const presented = recordPresentation(first.state, [first.state.instances[id].wait!.id], 2);
  const corrected = transitionCustomer(presented, { ...event, id: "c", message: "11:00" }, { revision: presented.revision, needsClarification: false,
    commands: [{ kind: "facts", instanceId: id, values: [{ fieldId: key("time"), value: "11:00", evidence: "11:00" }] }] }, { ...env, now: 3 });
  expect(processPreparedRequest(corrected.state.instances[id], definitions[0], version, 3)).toMatchObject({
    review: "review_requested", collectedFields: expect.objectContaining({ [key("time")]: "11:00" }), transaction: "not_executed_by_agent",
  });
});
