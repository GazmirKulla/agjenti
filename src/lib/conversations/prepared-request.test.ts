import { describe, expect, it } from "vitest";
import { migrateContext, setFact } from "@/lib/workflows/context";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { bookingReviewKey, type BookingDraft } from "@/lib/calendar/agent";
import { preparedRequest } from "./prepared-request";

const entity = { id: "service", kind: "service" as const, name: "Consultation" };
function fixture(booking = false) {
  const state = migrateContext();
  const version: VisualVersion = { id: "A", businessId: "tenant", createdAt: "", graph: {
    version: 2, name: "Synthetic", nodes: [
      { id: "details", kind: booking ? "booking" : "collect", label: "Details", position: { x: 0, y: 0 }, config: { fieldKey: "project_type", fieldType: "text" } },
      { id: "branch", kind: "condition", label: "Branch", position: { x: 0, y: 0 }, config: {} },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 0 }, config: {} },
    ], edges: [{ id: "one", source: "details", target: "branch", port: "next" }, { id: "two", source: "branch", target: "end", port: "yes" }],
    flows: [{ id: "service", kind: booking ? "booking" : "custom", label: "Service", entryNodeId: "details", nodeIds: ["details", "branch"], serviceIds: [entity.id] }],
  } };
  state.visual = { versionId: "A", nodeId: "details", status: "waiting", awaiting: true, values: {}, visited: [],
    binding: { flowId: "service", entity: { kind: "service", id: entity.id } },
    collection: { businessId: "tenant", versionId: "A", flowId: "service", revision: 1, domain: booking ? "booking" : "service", mode: "collection_only", profileFields: [] } };
  return { state, version };
}
describe("prepared request is evidence, not transaction authority", () => {
  it("does not certify an unresolved branch or infer staff delivery from nextState", () => {
    const { state, version } = fixture();
    setFact(state, "project_type", "Website", "text", "customer");
    expect(preparedRequest(state, version, entity)?.validation).toBe("unverified");
    state.visual!.branchPorts = { branch: "yes" };
    state.staffHandoff = true;
    expect(preparedRequest(state, version, entity)).toMatchObject({ validation: "valid", review: "ready_for_review", handoff: "requested" });
    expect(preparedRequest(state, { ...version, businessId: "other" }, entity)).toBeUndefined();
    expect(preparedRequest(state, version, { ...entity, id: "other" })).toBeUndefined();
  });
  it("booking confirms only current, unexpired facts for the verified service", () => {
    const { state, version } = fixture(true);
    const draft: BookingDraft = { phase: "confirm", nonce: "nonce", expires: Date.now() + 60000, serviceId: entity.id, date: "2027-01-20", time: "10:00", name: "Synthetic" };
    const factsKey = bookingReviewKey(version.businessId, draft, version.id);
    draft.review = { factsKey }; draft.preparedConfirmation = { factsKey };
    state.fields.booking = draft;
    expect(preparedRequest(state, version, entity)?.review).toBe("customer_confirmed");
    draft.time = "11:00";
    expect(preparedRequest(state, version, entity)?.review).toBe("ready_for_review");
    draft.time = "10:00"; draft.expires = 0;
    expect(preparedRequest(state, version, entity)?.review).toBe("ready_for_review");
    draft.serviceId = "other";
    expect(preparedRequest(state, version, entity)).toBeUndefined();
  });
});
