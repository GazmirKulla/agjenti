import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot, type Observation } from "@/lib/orchestration/contracts";
import { compileVisualProcesses } from "@/lib/orchestration/visual-definition";
import { serviceContext } from "@/lib/orchestration/service-context";
import { serviceFields } from "@/lib/orchestration/service-definition";
import { recordPresentation, transitionCustomer, type Environment } from "@/lib/orchestration/transition";
import type { VisualVersion } from "@/lib/workflows/visual/types";
const { terms } = vi.hoisted(() => ({ terms: vi.fn() }));
vi.mock("@/lib/orchestration/booking", () => ({ readBookingTerms: terms }));
const basic = "11111111-1111-4111-8111-111111111111", plus = "22222222-2222-4222-8222-222222222222";
const version: VisualVersion = { id: "v1", businessId: "business", createdAt: "today", graph: { version: 2, name: "Services",
  flows: [{ id: "service", label: "Service request", kind: "custom", entryNodeId: "detail", nodeIds: ["detail"], serviceIds: [basic, plus] }],
  nodes: [{ id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "detail", kind: "collect", label: "Details", position: { x: 0, y: 0 }, config: { fieldKey: "details", prompt: "Details?" } },
    { id: "end", kind: "end", label: "Done", position: { x: 0, y: 0 }, config: {} }],
  edges: [{ id: "s", source: "start", target: "end", port: "next" }, { id: "d", source: "detail", target: "end", port: "next" }] } };
beforeEach(() => { terms.mockReset(); terms.mockImplementation(async (_business, id) => ({ serviceName: id === plus ? "Consult Plus" : "Consult Basic" })); });
function setup() {
  const definitions = compileVisualProcesses(version), context = serviceContext([version]);
  const env: Environment = { mode: "test", now: 10, definitions, startableVersionIds: new Set([version.id]), tools: [], promptTtlMs: 1000, serverFacts: context.serverFacts };
  const event = { id: "event", businessId: "business", conversationId: "conversation", actor: "customer" as const, message: "Service information" };
  return { definitions, context, env, event, state: initialSnapshot("business", "conversation", "test") };
}
it("an informational service reference does not create a request or booking", () => {
  const h = setup();
  const result = transitionCustomer(h.state, h.event, { revision: 0, commands: [], needsClarification: false }, h.env);
  expect(result.state.instances).toEqual({}); expect(result.actions).toEqual([]);
});
it.each(["shërbimin e dytë", "the second service", "el segundo servicio"])("accepts a delivered service offer using a structured relative reference: %s", async message => {
  const h = setup();
  const offered = transitionCustomer(h.state, h.event, { revision: 0, commands: [{ kind: "offer", definitionId: "service", versionId: "v1", evidence: h.event.message }], needsClarification: false }, h.env);
  const offerId = Object.keys(offered.state.offers)[0], state = recordPresentation(offered.state, [offerId], 10);
  const observation: Observation = { revision: state.revision, needsClarification: false, commands: [{ kind: "accept_offer", offerId, evidence: message,
    initialFacts: [{ fieldId: serviceFields("service").key("id"), value: plus, evidence: message }] }] };
  await h.context.prepare(state, h.definitions, observation);
  const result = transitionCustomer(state, { ...h.event, id: "accept", message }, observation, h.env), instance = result.state.instances[result.state.focusId!];
  expect(instance).toMatchObject({ versionId: "v1", status: "waiting_input", wait: { fieldId: "details" } });
  expect(instance.facts[serviceFields("service").key("name")].value).toBe("Consult Plus");
  expect(result.actions).toEqual([]);
  expect(terms).toHaveBeenCalledWith("business", plus, true);
  expect(result.state.offers[offerId]).toBeUndefined();
});
it.each(["expired", "undelivered", "foreign"])("rejects a %s offer without starting a service", reason => {
  const h = setup();
  const offered = transitionCustomer(h.state, h.event, { revision: 0, commands: [{ kind: "offer", definitionId: "service", versionId: "v1", evidence: h.event.message }], needsClarification: false }, h.env);
  const offerId = Object.keys(offered.state.offers)[0];
  const state = reason === "undelivered" ? offered.state : recordPresentation(offered.state, [offerId], 10);
  if (reason === "expired") state.offers[offerId].expiresAt = 0;
  expect(() => transitionCustomer(state, { ...h.event, ...(reason === "foreign" ? { businessId: "foreign" } : {}) }, { revision: state.revision, needsClarification: false,
    commands: [{ kind: "accept_offer", offerId, evidence: h.event.message, initialFacts: [] }] }, h.env)).toThrow();
});
it("preserves ambiguity without selecting a service or converting it to an order", () => {
  const h = setup(), result = transitionCustomer(h.state, h.event, { revision: 0, commands: [], needsClarification: true }, h.env);
  expect(result.state.instances).toEqual({}); expect(result.actions).toEqual([]); expect(result.notices).toEqual([{ kind: "clarify" }]);
});
it("rejects a service outside the configured workflow even when the model supplies a valid identifier", async () => {
  const h = setup(), message = "Choose that service";
  const observation: Observation = { revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: "service", versionId: "v1", evidence: message,
    initialFacts: [{ fieldId: serviceFields("service").key("id"), value: "33333333-3333-4333-8333-333333333333", evidence: message }] }] };
  await h.context.prepare(h.state, h.definitions, observation);
  expect(() => transitionCustomer(h.state, { ...h.event, message }, observation, h.env)).toThrow("service_outside_workflow");
});
