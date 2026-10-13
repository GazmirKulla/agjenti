import { describe, expect, it } from "vitest";
import { emptyState, type WorkflowStepDef } from "./engine";
import { advanceSharedOrder, freshOrderReview, migrateContext, setFact, sharedPrompt } from "./context";
import { bookingAdapterState, migrateConversationProcesses, restoreOrder, snapshotOrder } from "./conversation-processes";

const steps: WorkflowStepDef[] = [{ key: "size", kind: "text", label: "Madhësia" }, { key: "customer", kind: "customer" }];
function reviewing() {
  const state = migrateContext(emptyState());
  state.product_id = "product-a"; state.step_key = "customer";
  state.context!.execution.linear = { id: "order-flow", versionId: "immutable-v1", name: "Order", steps };
  for (const [key, value] of Object.entries({ name: "Ana", phone: "0691111111", city: "Tiranë", address: "Rruga A" }))
    setFact(state, `customer_${key}`, value, "text", "customer");
  setFact(state, "size", "M", "text", "customer");
  return advanceSharedOrder(state, "", false, steps);
}
function task() { return migrateConversationProcesses(reviewing(), () => "order-a"); }

describe("W2 canonical facts and confirmation freshness", () => {
  it("excludes service_interest and unknown legacy fields from the order review", () => {
    const legacy = emptyState(); legacy.fields = { service_interest: "Konsultim", size: "M", arbitrary: "OTHER" };
    legacy.step_key = "order_confirm";
    const state = migrateContext(legacy);
    const reply = sharedPrompt(state, steps, "Produkt");
    expect(reply).toContain("Madhësia: M");
    expect(reply).not.toContain("Konsultim"); expect(reply).not.toContain("OTHER");
    expect(state.context!.execution.orderReview!.fieldKeys).toEqual(["size"]);
  });
  it("restores progress but not the previous phone or approval while booking owns state", () => {
    const state = task();
    const confirmed = advanceSharedOrder(state, "Po", false, steps);
    confirmed.processes!.order!.snapshot = snapshotOrder(confirmed);
    const booking = bookingAdapterState(confirmed);
    setFact(booking, "customer_phone", "0692222222", "phone", "correction");
    const resumed = restoreOrder(booking, { resume: true });
    expect(resumed.customer.phone).toBe("0692222222");
    expect(resumed.context!.order.size.value).toBe("M");
    expect(resumed.context!.execution.linear!.versionId).toBe("immutable-v1");
    expect(freshOrderReview(resumed, true)).toBe(false);
    expect(resumed.step_key).toBe("order_confirm");
  });
  it("never lets an older snapshot overwrite newer live order facts, selection or progress", () => {
    const state = task(); const old = structuredClone(state.processes!.order!.snapshot);
    setFact(state, "size", "L", "text", "correction");
    state.product_id = "product-b"; state.step_key = "size";
    const restored = restoreOrder(state);
    expect(restored.product_id).toBe("product-b"); expect(restored.fields.size).toBe("L");
    expect(restored.step_key).toBe("size"); expect(restored.context!.order.size.value).toBe("L");
    expect(state.processes!.order!.snapshot).toEqual(old);
    expect(restoreOrder(restored)).toEqual(restored);
  });
  it("keeps completedVisual as immutable history, never as current facts", () => {
    const state = task();
    state.completedVisual = { versionId: "history-new", nodeId: "end", status: "completed", visited: [], awaiting: false, values: { customer_phone: "0690000000", size: "OLD" } };
    state.processes!.order!.snapshot.completedVisual = { ...state.completedVisual, versionId: "history-old" };
    const before = structuredClone(state);
    const restored = restoreOrder(state);
    expect(restored.completedVisual).toEqual(state.completedVisual);
    expect(restored.fields.size).toBe("M"); expect(restored.customer.phone).toBe("0691111111");
    expect(state).toEqual(before);
    expect(bookingAdapterState(state).completedVisual).toEqual(state.completedVisual);
  });
  it("isolates booking fields and preserves each process's selected entity", () => {
    const state = task(); state.processes!.active = "booking";
    state.processes!.booking = { id: "b", status: "active", draft: { serviceId: "service-b", nonce: "b", phase: "collect", expires: Date.now() + 10000 }, order: { reason: { value: "Consultation", type: "text", source: "booking", validated: true } }, fields: { reason: "Consultation" } };
    const booking = bookingAdapterState(state);
    expect(booking.product_id).toBeNull(); expect(booking.context!.order.size).toBeUndefined();
    const restored = restoreOrder(booking);
    expect(restored.product_id).toBe("product-a"); expect(restored.context!.order.reason).toBeUndefined();
    expect(restored.fields.reason).toBeUndefined();
    expect(restored.processes!.booking!.draft!.serviceId).toBe("service-b");
  });
  it.each([undefined, 2, 3] as const)("reads schema %s without promoting old flags into a valid approval", schemaVersion => {
    const input = { ...emptyState(), schemaVersion, product_id: "p", step_key: "order_ready", fields: { size: "M" } };
    input.customer.phone = "0691111111";
    const state = migrateConversationProcesses(input, () => "legacy");
    expect(state.schemaVersion).toBe(3); expect(state.customer.phone).toBe(input.customer.phone);
    expect(state.context!.order.size.value).toBe("M"); expect(freshOrderReview(state, true)).toBe(false);
  });
  it.each(["product", "phone", "size", "version", "expired", "missing"])("cannot accept a %s-stale order review", change => {
    const state = reviewing();
    if (change === "product") state.product_id = "another-product";
    if (change === "phone") setFact(state, "customer_phone", "0692222222", "phone", "correction");
    if (change === "size") setFact(state, "size", "L", "text", "correction");
    if (change === "version") state.context!.execution.linear!.versionId = "different-v2";
    if (change === "expired") state.context!.execution.orderReview!.expiresAt = Date.now() - 1;
    if (change === "missing") delete state.context!.execution.orderReview;
    expect(freshOrderReview(state)).toBe(false);
    const result = advanceSharedOrder(state, "Po", false, steps);
    expect(result.step_key).toBe("order_confirm"); expect(result.context!.execution.orderConfirmed).toBe(false);
    expect(advanceSharedOrder(result, "Po", false, steps).step_key).toBe("order_ready");
  });
  it("does not renew a confirmed receipt on duplicate yes, and expiry blocks later action", () => {
    const confirmed = advanceSharedOrder(reviewing(), "Po", false, steps);
    const again = advanceSharedOrder(confirmed, "Po", false, steps);
    expect(again.context!.execution.orderReview).toEqual(confirmed.context!.execution.orderReview);
    again.context!.execution.orderReview!.expiresAt = Date.now() - 1;
    expect(freshOrderReview(again, true)).toBe(false);
  });
  it("uses canonical profile values instead of contradictory legacy projections", () => {
    const state = reviewing(); state.customer.phone = "0690000000"; state.fields.size = "XL";
    expect(migrateContext(state).customer.phone).toBe("0691111111");
    expect(sharedPrompt(state, steps)).toContain("Madhësia: M");
    expect(freshOrderReview(state)).toBe(true);
  });
  it("binds the displayed field set and does not approve a newly expanded review", () => {
    const state = reviewing();
    const changedSteps: WorkflowStepDef[] = [...steps, { key: "engraving", kind: "text" }];
    setFact(state, "engraving", "Text", "text", "message");
    const next = advanceSharedOrder(state, "Po", false, changedSteps);
    expect(next.step_key).toBe("order_confirm");
    expect(next.context!.execution.orderReview!.fieldKeys).toEqual(["engraving", "size"]);
  });
  it("restoring canonical projections does not mutate the supplied snapshot", () => {
    const state = task(); state.customer.phone = "0690000000";
    const before = structuredClone(state);
    expect(restoreOrder(state).customer.phone).toBe("0691111111");
    expect(state).toEqual(before);
  });
  it("invalidates even an attempted invalid profile correction on the suspended order", () => {
    const state = bookingAdapterState(task());
    expect(setFact(state, "customer_phone", "invalid", "phone", "correction")).toBe(false);
    expect(state.processes!.order!.snapshot.execution.orderReview).toBeUndefined();
    expect(freshOrderReview(restoreOrder(state))).toBe(false);
  });
});
