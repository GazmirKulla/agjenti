import { describe, expect, it, vi } from "vitest";
import { emptyState, type ConversationStatePayload } from "./engine";
import { bookingAdapterState, migrateConversationProcesses, restoreOrder } from "./conversation-processes";
import type { VisualVersion } from "./visual/types";
import { advanceVisualWorkflow } from "./visual/runtime";

const version: VisualVersion = {
  id: "pinned-v1", businessId: "business", createdAt: "2026-10-11",
  graph: { version: 2, name: "Demo", edges: [{ id: "next", source: "details", target: "book", port: "next" }],
    nodes: [
      { id: "details", kind: "collect", label: "Arsyeja", config: { fieldKey: "reason" }, position: { x: 0, y: 0 } },
      { id: "book", kind: "booking", label: "Rezervimi", config: {}, position: { x: 1, y: 0 } },
      { id: "product", kind: "product", label: "Produkti", config: {}, position: { x: 2, y: 0 } },
      { id: "info", kind: "knowledge", label: "Informacion", config: {}, position: { x: 3, y: 0 } },
    ], flows: [
      { id: "appointments", kind: "booking", label: "Rezervim", entryNodeId: "details", nodeIds: ["details", "book"] },
      { id: "orders", kind: "order", label: "Porosi", entryNodeId: "product", nodeIds: ["product"] },
      { id: "information", kind: "information", label: "Informacion", entryNodeId: "info", nodeIds: ["info"] },
    ] },
};
function bookingState(withDraft = true): ConversationStatePayload {
  const state = emptyState(); state.schemaVersion = 2;
  state.visual = { versionId: version.id, nodeId: withDraft ? "book" : "details", status: "waiting", awaiting: true,
    visited: ["details"], values: { reason: "Kontroll" }, forceCollect: "details", branchPorts: { choice: "yes" },
    binding: { flowId: "appointments", entity: { kind: "service", id: "service-1" } } };
  if (withDraft) {
    state.step_key = "booking_request";
    state.fields.booking = { nonce: "booking-1", phase: "collect", date: "2026-10-15", expires: 1900000000000 };
  }
  return state;
}

describe("legacy process migration", () => {
  it.each([true, false])("preserves the booking cursor and pinned version (draft=%s)", draft => {
    const input = bookingState(draft), before = structuredClone(input);
    const state = migrateConversationProcesses(input, () => "task-1", version);
    expect(state.processes?.order).toBeUndefined();
    expect(state.processes?.active).toBe("booking");
    expect(state.processes?.promptOwner).toBe("booking");
    expect(state.processes?.booking).toMatchObject({ id: draft ? "booking-1" : "task-1", status: "active", versionId: version.id, visual: input.visual });
    const adapter = bookingAdapterState(state);
    expect(adapter.visual).toEqual(input.visual);
    expect(adapter.fields.booking).toEqual(input.fields.booking);
    expect(input).toEqual(before);
    adapter.visual!.values.reason = "Ndryshuar";
    expect(state.processes?.booking?.visual?.values.reason).toBe("Kontroll");
    const id = vi.fn();
    expect(migrateConversationProcesses(state, id, version)).toEqual(state);
    expect(id).not.toHaveBeenCalled();
  });

  it("keeps an independent linear order without assigning it the booking cursor", () => {
    const input = bookingState(); input.product_id = "product-1";
    input.linearSnapshot = { id: "order", versionId: "order-v1", name: "Porosi", steps: [{ key: "size", kind: "text" }] };
    input.fields.size = "M";
    const state = migrateConversationProcesses(input, () => "order-1", version);
    expect(state.processes?.order?.status).toBe("suspended");
    const restored = restoreOrder(state);
    expect(restored.product_id).toBe("product-1");
    expect(restored.fields.size).toBe("M");
    expect(restored.visual).toBeUndefined();
    expect(bookingAdapterState(state).visual).toEqual(input.visual);
  });

  it.each(["completed", "handoff"] as const)("does not activate a %s booking", status => {
    const input = bookingState(); input.visual!.status = status; input.visual!.awaiting = false;
    const state = migrateConversationProcesses(input, () => "task", version);
    expect(state.processes?.active).toBeNull();
    expect(state.processes?.promptOwner).toBeNull();
    expect(state.processes?.booking?.status).toBe(status === "completed" ? "completed" : "suspended");
    expect(state.processes?.booking?.visual).toEqual(input.visual);
    expect(state.processes?.order).toBeUndefined();
  });

  it("does not infer an order from an unknown cursor or an invalid booking draft", () => {
    const input = bookingState(false); input.visual!.nodeId = "unknown"; delete input.visual!.binding;
    input.fields.booking = { date: "2026-10-15" };
    const state = migrateConversationProcesses(input, () => "task");
    expect(state.processes).toEqual({ active: null, promptOwner: null });
    expect(state.visual).toEqual(input.visual);
    expect(state.fields).toEqual(input.fields);
  });

  it("does not turn information into an order", () => {
    const input = bookingState(false); input.visual!.nodeId = "info"; delete input.visual!.binding;
    const state = migrateConversationProcesses(input, () => "task", version);
    expect(state.processes?.active).toBeNull();
    expect(state.processes?.order).toBeUndefined();
    expect(state.visual).toEqual(input.visual);
  });

  it("continues the exact pending collect after migration", () => {
    const input = bookingState(false);
    const adapter = bookingAdapterState(migrateConversationProcesses(input, () => "task", version));
    const result = advanceVisualWorkflow({ graph: version.graph, versionId: version.id, state: adapter.visual,
      message: "Kontroll i ri", hasPhoto: false, intent: "booking" });
    expect(result.action.kind).toBe("booking");
    expect(result.state.values.reason).toBe("Kontroll i ri");
    expect(result.state.binding).toEqual(input.visual!.binding);
    expect(result.state.branchPorts).toEqual(input.visual!.branchPorts);
  });

  it.each(["book", "details"])("recognizes a V1 booking at %s without a draft or binding", nodeId => {
    const pinned: VisualVersion = { ...version, graph: { ...version.graph, version: 1 } };
    const input = bookingState(false); input.visual!.nodeId = nodeId; delete input.visual!.binding;
    const state = migrateConversationProcesses(input, () => "task", pinned);
    expect(state.processes?.booking?.visual).toEqual(input.visual);
    expect(state.processes?.order).toBeUndefined();
    expect(state.processes?.active).toBe("booking");
  });

  it("does not guess a V1 process when a collect can lead to either action", () => {
    const pinned: VisualVersion = { ...version, graph: { ...version.graph, version: 1,
      edges: [...version.graph.edges, { id: "other", source: "details", target: "product", port: "no" }] } };
    const input = bookingState(false); delete input.visual!.binding;
    const state = migrateConversationProcesses(input, () => "task", pinned);
    expect(state.processes).toEqual({ active: null, promptOwner: null });
    expect(state.visual).toEqual(input.visual);
  });

  it("keeps a non-bookable service separate from orders and bookings", () => {
    const pinned = structuredClone(version);
    if (pinned.graph.version !== 2) throw new Error("Expected v2");
    pinned.graph.flows[0].kind = "custom"; pinned.graph.flows[0].nodeIds = ["details"];
    const input = bookingState(false);
    const state = migrateConversationProcesses(input, () => "service-task", pinned);
    expect(state.processes?.booking).toBeUndefined();
    expect(state.processes?.order).toBeUndefined();
    expect(state.processes?.service).toMatchObject({ versionId: version.id, visual: input.visual, status: "active", promptCurrent: true });
  });

  it("rejects a different publication rather than reinterpreting the cursor", () => {
    expect(() => migrateConversationProcesses(bookingState(), () => "task", { ...version, id: "latest" })).toThrow("workflow_version_mismatch");
  });

  it("recognizes a booking action embedded in a flow labelled order", () => {
    const pinned = structuredClone(version);
    if (pinned.graph.version !== 2) throw new Error("Expected v2");
    pinned.graph.flows[0].kind = "order";
    const input = bookingState();
    const state = migrateConversationProcesses(input, () => "task", pinned);
    expect(state.processes?.active).toBe("booking");
    expect(state.processes?.booking?.visual).toEqual(input.visual);
    expect(state.processes?.order).toBeUndefined();
  });

  it("preserves a legacy nonvisual booking and its identity", () => {
    const input = bookingState(); delete input.visual;
    const state = migrateConversationProcesses(input, () => "unused");
    expect(state.processes?.booking).toMatchObject({ id: "booking-1", draft: input.fields.booking, status: "active" });
    expect(state.processes?.order).toBeUndefined();
    expect(state.processes?.active).toBe("booking");
  });

  it("preserves a pending product cursor and completed linear order", () => {
    const input = bookingState(false); input.product_id = "product-1";
    input.visual!.nodeId = "product"; input.visual!.binding = { flowId: "orders", entity: { kind: "product", id: "product-1" } };
    const state = migrateConversationProcesses(input, () => "order-1", version);
    expect(state.processes?.active).toBe("order");
    expect(restoreOrder(state).visual).toEqual(input.visual);
    const completed = emptyState(); completed.product_id = "product-1"; completed.step_key = "order_ready";
    const done = migrateConversationProcesses(completed, () => "order-1");
    expect(done.processes?.order?.status).toBe("completed");
    expect(done.processes?.active).toBeNull();
  });

  it.each([null, undefined, {} as ConversationStatePayload])("handles empty/partial state %s", input => {
    const state = migrateConversationProcesses(input, () => "task");
    expect(state.processes).toEqual({ active: null, promptOwner: null });
    expect(state.schemaVersion).toBe(3);
  });
});
