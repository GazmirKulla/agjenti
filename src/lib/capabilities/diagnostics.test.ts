import { expect, it } from "vitest";
import { capabilityFinding } from "./diagnostics";
import { simulateWorkflowProposal } from "@/lib/workflows/visual/simulation";
import { evaluatePublicationPolicy } from "@/lib/workflows/visual/publication-policy";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { CapabilityAssessment } from "./registry";
const graph = upgradeVisualGraph(starterVisualGraph());
const missing: CapabilityAssessment[] = [
  { capabilityKey: "product.search", status: "needs_setup", reasonCode: "missing_requirements", missingRequirements: ["active_products"] },
  { capabilityKey: "order.prepare", status: "needs_setup", reasonCode: "module_disabled", missingRequirements: ["module:orders"] },
  { capabilityKey: "inventory.check", status: "unsupported", reasonCode: "unknown_capability", missingRequirements: [] },
];
it("keeps separate actionable diagnostics for setup, disabled modules and unsupported capabilities", () => {
  const report = simulateWorkflowProposal({ proposalId: "test", baseRevision: 0, before: graph, candidate: graph, capabilities: missing });
  const blocked = report.scenarios.filter(s => s.category === "capability" && s.result === "BLOCKED");
  expect(blocked).toHaveLength(3);
  expect(blocked.every(s => s.result === "BLOCKED" && s.executionCount === 0 && !s.traversedNodeIds.length)).toBe(true);
  expect(blocked[0].validationFindings[0]).toMatchObject({ capabilityKey: "product.search", reasonCode: "missing_requirements", missingRequirements: ["active_products"], affectedNodeIds: ["product"], remediation: expect.stringContaining("katalog") });
  expect(blocked[1].validationFindings[0].remediation).toContain("modulin orders");
  expect(blocked[2].validationFindings[0].remediation).toContain("Nuk do të ekzekutohet");
  expect(report.canPublish).toBe(false);
  for (const s of report.scenarios.filter(s => ["BLOCKED", "UNVERIFIED"].includes(s.result))) {
    expect(s.validationFindings.length).toBeGreaterThan(0);
    for (const f of s.validationFindings) expect(f).toEqual(expect.objectContaining({ capabilityKey: expect.toSatisfy(v => v === null || typeof v === "string"), reasonCode: expect.any(String), missingRequirements: expect.any(Array), affectedNodeIds: expect.any(Array), remediation: expect.any(String) }));
  }
});
it.each(["manual_legacy", "assistant_strict"] as const)("preserves %s publication blockers with the same specific evidence", mode => {
  const result = evaluatePublicationPolicy({ mode, authorized: true, businessId: "tenant", userId: "actor", revision: 0, candidate: graph, capabilities: missing });
  expect(result).toMatchObject({ result: "BLOCKED", canPublish: false, canRequestApproval: false });
  expect(result.findings.map(f => f.capabilityKey)).toEqual(missing.map(c => c.capabilityKey));
});
it("does not serialize evidence, integration values or unknown private configuration", () => {
  const result = capabilityFinding({ ...missing[0], evidence: ["private-token"], safeAlternative: "private-token", missingRequirements: ["private-token"] }, graph);
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(result.missingRequirements).toEqual(["configuration_review_required"]);
});
it("identifies the capability whose external execution was not attempted", () => {
  const report = simulateWorkflowProposal({ proposalId: "test", baseRevision: 0, before: graph, candidate: graph });
  const scenario = report.scenarios.find(s => s.scenarioId === "action:product")!;
  expect(scenario.result).toBe("UNVERIFIED"); expect(scenario.executionCount).toBeGreaterThan(0);
  expect(scenario.validationFindings).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityKey: "order.prepare", nodeId: "product", missingRequirements: ["isolated_execution_evidence"] })]));
});
