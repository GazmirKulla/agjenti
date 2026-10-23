import { beforeEach, expect, it, vi } from "vitest";
import { migrateContext, setFact, freshOrderReview } from "@/lib/workflows/context";
import { snapshotOrder } from "@/lib/workflows/conversation-processes";
import { advanceVisualOrderReview } from "@/lib/workflows/visual/product-order";
import { withCollectionPolicy } from "@/lib/runtime/execution-context";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { correctPreparedRequest } from "./prepared-request-correction";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { bookingReviewKey, type BookingDraft } from "@/lib/calendar/agent";

const mocks = vi.hoisted(() => ({ modules: vi.fn(), resolve: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/capabilities/enforcement", async importOriginal => ({ ...await importOriginal<object>(), requireRuntimeModules: mocks.modules }));
vi.mock("@/lib/workflows/visual/entity-routing", () => ({ resolveVisualEntity: mocks.resolve }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
const entity = { id: "product", kind: "product" as const, name: "Synthetic product" };
const binding = { flowId: "order", entity: { id: entity.id, kind: entity.kind } };
let submitted: { order_id: string } | null, dbError: object | null;
const reads: Record<string, unknown>[] = [];
function fixture() {
  const pin = { businessId: "tenant", versionId: "A", flowId: "order", revision: 1, domain: "order" as const, mode: "collection_only" as const, profileFields: ["phone" as const] };
  const version: VisualVersion = { id: "A", businessId: "tenant", createdAt: "", collectionPolicy: { version: 1, revision: 1, scopes: [pin] }, graph: {
    version: 2, name: "Synthetic", nodes: [
      { id: "quantity", kind: "collect", label: "Quantity", config: { fieldKey: "quantity", fieldType: "number" }, position: { x: 0, y: 0 } },
      { id: "end", kind: "end", label: "End", config: {}, position: { x: 0, y: 0 } },
    ], edges: [{ id: "next", source: "quantity", target: "end", port: "next" }],
    flows: [{ id: "order", kind: "order", label: "Order", entryNodeId: "quantity", nodeIds: ["quantity"], productIds: [entity.id] }],
  } };
  let state = migrateContext(); state.schemaVersion = 3; state.product_id = entity.id;
  state.context!.execution.factOwner = "order";
  state.visual = { versionId: "A", nodeId: "end", status: "waiting", awaiting: true, values: { quantity: "2" }, visited: ["quantity", "end"], binding, collection: pin };
  setFact(state, "quantity", "2", "number", "customer");
  setFact(state, "customer_phone", "+355691234567", "phone", "customer");
  state = withCollectionPolicy(pin, () => advanceVisualOrderReview(state, "", false, true, version.graph, entity.name)).nextState;
  state = withCollectionPolicy(pin, () => advanceVisualOrderReview(state, "po", false, false, version.graph, entity.name)).nextState;
  state.visual!.status = "completed"; state.visual!.awaiting = false;
  state.processes = { active: null, promptOwner: null, order: { id: "original-process", status: "completed", snapshot: snapshotOrder(state) } };
  expect(freshOrderReview(state, true)).toBe(true);
  return { businessId: "tenant", version, state, message: "telefoni: +355699876543" };
}
beforeEach(() => {
  vi.clearAllMocks(); reads.length = 0; submitted = null; dbError = null;
  mocks.modules.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue({ selected: { entity, binding } });
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe("order_submissions");
    const filters: Record<string, unknown> = {}; reads.push(filters);
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      limit: () => chain, maybeSingle: async () => ({ data: submitted, error: dbError }) };
    return chain; // No insert/update/RPC capability in this regression.
  });
});

it("reopens only final review with a fresh receipt, same process/entity/version and canonical facts", async () => {
  const input = fixture(), before = structuredClone(input.state);
  const result = (await correctPreparedRequest(input))!;
  expect(input.state).toEqual(before);
  expect(result.corrected).toBe(true);
  expect(result.state.step_key).toBe("order_confirm");
  expect(result.state.processes?.order).toMatchObject({ id: "original-process", status: "active" });
  expect(result.state.visual).toMatchObject({ versionId: "A", nodeId: "end", status: "waiting", binding });
  expect(result.preparedRequest).toMatchObject({ review: "review_requested", collectedFields: { customer_phone: "+355699876543", quantity: "2" }, transaction: "not_executed_by_agent" });
  expect(result.state.context!.execution.orderReview!.id).not.toBe(before.context!.execution.orderReview!.id);
  expect(freshOrderReview(result.state, true)).toBe(false);
  expect(freshOrderReview(result.state, false)).toBe(true);
  const replay = structuredClone(result.state);
  replay.context!.execution.orderReview = before.context!.execution.orderReview;
  expect(freshOrderReview(replay, true)).toBe(false);
  const confirmed = withCollectionPolicy(result.state.visual!.collection, () => advanceVisualOrderReview(result.state, "po", false, false, input.version.graph, entity.name));
  expect(freshOrderReview(confirmed.nextState, true)).toBe(true);
  expect(confirmed.complete).toBe(true);
  expect(reads).toEqual([{ business_id: "tenant", confirmation_id: before.context!.execution.orderReview!.id }]);
  expect(mocks.modules).toHaveBeenCalledWith("tenant", expect.arrayContaining(["workflows", "products", "orders"]));
});

it.each(["telefoni: many", "email: foreign@example.test", "quantity: 4", "telefoni: +355699876543; city: X"])("does not partially mutate invalid/unowned correction %s", async message => {
  const input = fixture(), before = structuredClone(input.state);
  const result = (await correctPreparedRequest({ ...input, message }))!;
  expect(result.corrected).toBe(false); expect(result.state).toEqual(before);
  expect(result.preparedRequest?.collectedFields.customer_phone).toBe("+355691234567");
});
it.each(["staff", "paused", "cancelled", "expired", "superseded", "other_owner", "snapshot"])("does not revive %s process", async reason => {
  const input = fixture(), s = input.state;
  if (reason === "staff") s.staffHandoff = true;
  if (reason === "paused") s.conversationPaused = true;
  if (reason === "cancelled") delete s.processes!.order;
  if (reason === "expired") s.context!.execution.orderReview!.expiresAt = 0;
  if (reason === "superseded") s.product_id = "other";
  if (reason === "other_owner") s.processes!.active = "booking";
  if (reason === "snapshot") s.processes!.order!.snapshot.execution.orderReview!.id = "obsolete";
  const before = structuredClone(s);
  const result = (await correctPreparedRequest(input))!;
  expect(result.corrected).toBe(false); expect(result.state).toEqual(before);
});
it("does not reopen an existing business transaction", async () => {
  const input = fixture(); submitted = { order_id: "manual-order" };
  const result = (await correctPreparedRequest(input))!;
  expect(result.corrected).toBe(false); expect(result.state).toEqual(input.state);
});
it.each(["module", "tenant", "policy", "inactive_entity", "ledger_error"])("fails closed on %s", async reason => {
  const input = fixture();
  if (reason === "module") mocks.modules.mockRejectedValue(new CapabilityEnforcementError("module_disabled", "Disabled"));
  if (reason === "tenant") input.businessId = "other";
  if (reason === "policy") input.version.collectionPolicy!.revision++;
  if (reason === "inactive_entity") mocks.resolve.mockResolvedValue({});
  if (reason === "ledger_error") dbError = { message: "unavailable" };
  await expect(correctPreparedRequest(input)).rejects.toBeInstanceOf(CapabilityEnforcementError);
});
it("ignores existing execution mode and ordinary information", async () => {
  const input = fixture();
  expect(await correctPreparedRequest({ ...input, message: "What are your hours?" })).toBeUndefined();
  input.state.visual!.collection!.mode = "existing";
  expect(await correctPreparedRequest(input)).toBeUndefined();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not skip a graph-owned profile field or a conditional branch", async () => {
  const input = fixture();
  input.version.graph.nodes[0].config.fieldKey = "customer_phone";
  const result = (await correctPreparedRequest(input))!;
  expect(result.corrected).toBe(false);
  expect(result.state).toEqual(input.state);
});
it("duplicate corrections do not duplicate effects or replace process identity", async () => {
  const input = fixture();
  const [a, b] = await Promise.all([correctPreparedRequest(input), correctPreparedRequest(input)]);
  expect(a!.state.processes!.order!.id).toBe(b!.state.processes!.order!.id);
  expect(a!.preparedRequest).toEqual(b!.preparedRequest);
  expect(input.state.step_key).toBe("order_ready");
  expect(reads).toHaveLength(2); // Read-only. Transport CAS decides which nextState commits.
});
it.each(["service", "booking"] as const)("keeps %s projection and requests clarification instead of silently editing terminal facts", async domain => {
  const input = fixture();
  const service = { id: "service", kind: "service" as const, name: "Synthetic service" };
  const serviceBinding = { flowId: "order", entity: { id: service.id, kind: service.kind } };
  input.state.visual!.binding = serviceBinding;
  input.state.product_id = null;
  mocks.resolve.mockResolvedValue({ selected: { entity: service, binding: serviceBinding } });
  if (input.version.graph.version !== 2) throw new Error("fixture");
  input.version.graph.flows[0].kind = domain === "service" ? "custom" : "booking";
  delete input.version.graph.flows[0].productIds;
  input.version.graph.flows[0].serviceIds = [service.id];
  input.state.visual!.collection!.domain = domain;
  input.version.collectionPolicy!.scopes[0].domain = domain;
  input.state.visual!.collection!.profileFields = [];
  input.version.collectionPolicy!.scopes[0].profileFields = [];
  if (domain === "service") {
    input.state.processes!.service = { id: "service-process", versionId: "A", status: "completed", visual: input.state.visual!, order: structuredClone(input.state.context!.order), fields: {} };
    input.state.context!.order = {}; // Main order facts are not service-owned facts.
  } else {
    input.version.graph.nodes[0].kind = "booking";
    const draft: BookingDraft = { nonce: "booking", phase: "confirm", expires: Date.now() + 60000, serviceId: service.id, date: "2027-02-03", time: "10:00", name: "Synthetic" };
    const factsKey = bookingReviewKey("tenant", draft, "A");
    draft.review = { factsKey }; draft.preparedConfirmation = { factsKey };
    input.state.processes!.booking = { id: "booking-process", versionId: "A", status: "completed", visual: input.state.visual!, draft, fields: { booking: draft } };
  }
  const result = (await correctPreparedRequest(input))!;
  expect(result.corrected).toBe(false); expect(result.state).toEqual(input.state);
  expect(result.reply).toContain("nuk mbështetet");
  expect(result.preparedRequest).toMatchObject({ domain, entity: service, collectedFields: domain === "service" ? { quantity: "2" } : { "booking.time": "10:00" } });
  expect(mocks.from).not.toHaveBeenCalled();
});
