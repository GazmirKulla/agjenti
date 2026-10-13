import { buildAutomationProposal } from "@/lib/business-assistant/automation-proposal";
import { loadWorkflowReadiness } from "../readiness";
import { loadVisualVersion, loadVisualWorkspace } from "./store";
import { simulateWorkflowProposal } from "./simulation";
import { evaluatePublicationPolicy } from "./publication-policy";
import type { PublicationApproval } from "./publication-types";
import type { VisualGraph, VisualWorkspace } from "./types";

/** Reuses Phase 2 assessment, including unsupported prompt-action detection. Never uses browser evidence. */
export async function reviewWorkflowPublication(p: {
  businessId: string; userId: string; revision: number; graph: VisualGraph; proposalId: string;
  requestId?: string; approval?: PublicationApproval; confirming?: boolean; expectedPublishedVersionId?: string | null;
  /** A preparation call may reuse its already tenant-scoped snapshot. Writes always load fresh state. */
  prepared?: { workspace: VisualWorkspace; published: VisualGraph | null };
}) {
  const workspace = p.prepared?.workspace ?? await loadVisualWorkspace(p.businessId);
  const version = !p.prepared && workspace.publishedVersionId ? await loadVisualVersion(p.businessId, workspace.publishedVersionId) : null;
  const published = p.prepared?.published ?? version?.graph ?? workspace.graph;
  const automation = await buildAutomationProposal({ businessId: p.businessId, userId: p.userId, revision: p.revision,
    publishedVersionId: workspace.publishedVersionId, request: "Kontrollo draftin për publikim.",
    before: { version: 1, name: "", nodes: [], edges: [] }, after: p.graph, operations: [] });
  automation.proposalId = p.proposalId;
  const unavailable = automation.validationFindings.some(f => f.severity === "error");
  const simulation = simulateWorkflowProposal({ proposalId: p.proposalId, baseRevision: p.revision, before: published, candidate: p.graph,
    capabilities: automation.requiredCapabilities, assessmentUnavailable: unavailable, clarificationRequired: automation.clarificationQuestions.length > 0 });
  const runtime = p.graph.version === 2 ? await loadWorkflowReadiness(p.businessId) : { ready: true, blockers: [] };
  const publication = evaluatePublicationPolicy({ mode: "assistant_strict", ...p, candidate: p.graph,
    authorized: !unavailable, ownedVersion: !version || version.businessId === p.businessId,
    currentRevision: workspace.revision, currentDraft: workspace.graph, publishedVersionId: workspace.publishedVersionId,
    capabilities: automation.requiredCapabilities, assessmentUnavailable: unavailable, simulation, runtimeBlockers: runtime.blockers });
  return { publication, simulation, automation };
}
