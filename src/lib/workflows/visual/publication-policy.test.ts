import { describe, expect, it } from "vitest";
import { evaluatePublicationPolicy } from "./publication-policy";
import { simulateWorkflowProposal, simulationBinding } from "./simulation";
import { normalizeVisualDraft } from "./model";
import type { VisualGraph } from "./types";

const graph: VisualGraph = normalizeVisualDraft({ version: 1, name: "Local", nodes: [
  { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
  { id: "end", kind: "end", label: "End", position: { x: 0, y: 100 }, config: {} },
], edges: [{ id: "next", source: "start", target: "end", port: "next" }] })!;
function input(): Parameters<typeof evaluatePublicationPolicy>[0] {
  const simulation = simulateWorkflowProposal({ proposalId: "proposal", baseRevision: 4, candidate: graph, before: graph });
  return { mode: "assistant_strict", businessId: "business", userId: "user", authorized: true, ownedVersion: true,
    revision: 4, candidate: graph, currentRevision: 4, currentDraft: graph, publishedVersionId: "v1", expectedPublishedVersionId: "v1",
    proposalId: "proposal", requestId: "request", confirming: true, capabilities: [], simulation,
    approval: { ...simulationBinding(simulation), businessId: "business", userId: "user", requestId: "request", expires: Date.now() + 60000, publishedVersionId: "v1" } };
}
describe("shared publication policy", () => {
  it("requires explicit approval even with passing server evidence", () => {
    expect(evaluatePublicationPolicy({ ...input(), confirming: false })).toMatchObject({ result: "PASS", status: "approval_required", canPublish: false, canRequestApproval: true });
    expect(evaluatePublicationPolicy(input())).toMatchObject({ result: "PASS", status: "ready", canPublish: true });
  });
  it.each(["tenant", "actor", "request", "expiry", "hash", "proposal", "revision", "published"])("rejects approval with mismatched %s", kind => {
    const p = input(), a = p.approval!;
    if (kind === "tenant") a.businessId = "other";
    if (kind === "actor") a.userId = "other";
    if (kind === "request") a.requestId = "other";
    if (kind === "expiry") a.expires = Date.now() - 1;
    if (kind === "hash") a.candidateGraphHash = "other";
    if (kind === "proposal") a.proposalId = "other";
    if (kind === "revision") a.baseRevision++;
    if (kind === "published") a.publishedVersionId = "v2";
    expect(evaluatePublicationPolicy(p)).toMatchObject({ result: "BLOCKED", status: "stale_proposal", canPublish: false });
  });
  it("rejects missing authorization, foreign version ownership, stale drafts and changed publications", () => {
    for (const patch of [{ authorized: false }, { ownedVersion: false }, { currentRevision: 5 }, { publishedVersionId: "new" }, { currentDraft: { ...graph, name: "Changed" } }])
      expect(evaluatePublicationPolicy({ ...input(), ...patch }).canPublish).toBe(false);
  });
  it("rejects unsupported or newly unconfigured capabilities", () => {
    for (const status of ["needs_setup", "unsupported", "needs_clarification"] as const) {
      const result = evaluatePublicationPolicy({ ...input(), capabilities: [{ capabilityKey: "knowledge.answer", status, reasonCode: "changed", missingRequirements: ["active_knowledge"] }] });
      expect(result.canPublish).toBe(false); expect(result.result).toBe("BLOCKED");
    }
    expect(evaluatePublicationPolicy({ ...input(), capabilities: [{ capabilityKey: "inventory.check", status: "ready", reasonCode: "invented", missingRequirements: [] }] }).canPublish).toBe(false);
    expect(evaluatePublicationPolicy({ ...input(), assessmentUnavailable: true }).canPublish).toBe(false);
  });
  it.each(["FAIL", "BLOCKED", "UNVERIFIED"] as const)("does not accept a %s critical scenario even if overall flags claim success", status => {
    const p = input(); p.simulation!.scenarios[0].result = status;
    const result = evaluatePublicationPolicy(p);
    expect(result.result).toBe(status); expect(result.canPublish).toBe(false);
  });
  it("rejects missing evidence and graph changes after simulation", () => {
    const p = input(); p.simulation!.candidateGraphHash = "old";
    expect(evaluatePublicationPolicy(p)).toMatchObject({ status: "stale_proposal", canPublish: false });
    expect(evaluatePublicationPolicy({ ...input(), simulation: undefined }).canPublish).toBe(false);
    const empty = input(); empty.simulation!.scenarios = [];
    expect(evaluatePublicationPolicy(empty)).toMatchObject({ result: "UNVERIFIED", canPublish: false });
    const forged = input(); forged.simulation!.scenarios[0].executionCount = 0;
    expect(evaluatePublicationPolicy(forged).canPublish).toBe(false);
  });
  it("preserves manual compatibility explicitly as UNVERIFIED, never PASS", () => {
    const p = { ...input(), mode: "manual_legacy" as const, simulation: undefined, capabilities: undefined, approval: undefined };
    expect(evaluatePublicationPolicy(p)).toMatchObject({ result: "UNVERIFIED", canPublish: true, findings: [expect.objectContaining({ code: "manual_compatibility" })] });
    expect(evaluatePublicationPolicy({ ...p, authorized: false }).canPublish).toBe(false);
    expect(evaluatePublicationPolicy({ ...p, candidate: { ...graph, edges: [] } }).canPublish).toBe(false);
    expect(evaluatePublicationPolicy({ ...p, runtimeBlockers: ["Konfiguro rikuperimin."] })).toMatchObject({ status: "needs_setup", canPublish: false });
  });
});
