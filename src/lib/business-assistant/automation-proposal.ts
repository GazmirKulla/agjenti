import { randomUUID } from "node:crypto";
import { graphRequirements, nodeCapabilityKeys, flowCapabilityKeys } from "@/lib/capabilities/graph";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { enforceWorkflowCapabilities } from "@/lib/capabilities/workflow";
import { assessBusinessCapabilities } from "@/lib/capabilities/assessment";
import { getCapability, type CapabilityAssessment, type CapabilityReadiness } from "@/lib/capabilities/registry";
import { validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import type { Operation } from "./workflow";
import { AssistantError } from "./model";

import type { AutomationIntent } from "./automation-intent";
import type { SimulationBinding } from "@/lib/workflows/visual/simulation-types";
export type AutomationProposal = {
  simulation?: SimulationBinding;
  semanticEvidence?: WorkflowSemanticReview["evidence"];
  version: 1;
  proposalId: string;
  status: "proposed";
  readiness: CapabilityReadiness;
  baseRevision: number;
  workflowVersionId: string | null;
  requestedBehaviors: (AutomationIntent["requestedBehaviors"][number] & { readiness: CapabilityReadiness })[];
  /** Latest patch; the full normalized candidate remains in WorkflowCard.proposed (also for restore/refinement). */
  operations: Operation[];
  requiredCapabilities: CapabilityAssessment[];
  missingRequirements: string[];
  unsupportedActions: string[];
  assumptions: string[];
  clarificationQuestions: string[];
  validationFindings: { code: string; message: string; severity: "error" | "warning" }[];
  canSaveDraft: boolean;
};

import { reviewWorkflowSemantics, WorkflowSemanticReviewError, type WorkflowSemanticReview } from "@/lib/capabilities/workflow-semantics";

function graphCapabilities(before: VisualGraph, after: VisualGraph): string[] {
  const keys: string[] = [];
  // Connecting an existing node or assigning its flow is also a behavior change.
  const affected = new Set<string>();
  for (const edge of after.edges) {
    if (JSON.stringify(before.edges.find(e => e.id === edge.id)) !== JSON.stringify(edge)) {
      affected.add(edge.source); affected.add(edge.target);
    }
  }
  if (after.version === 2) for (const flow of after.flows) {
    const old = before.version === 2 ? before.flows.find(f => f.id === flow.id) : undefined;
    if (JSON.stringify(old) !== JSON.stringify(flow)) {
      flow.nodeIds.forEach(id => affected.add(id));
      keys.push(...flowCapabilityKeys(flow));
    }
  }
  for (const node of after.nodes) {
    if (!affected.has(node.id) && JSON.stringify(before.nodes.find(n => n.id === node.id)) === JSON.stringify(node)) continue;
    keys.push(...nodeCapabilityKeys(node));
  }
  return keys;
}

type ProposalInput = { businessId: string; userId: string; request: string; intent?: AutomationIntent } & (
  | { mode: "plan" }
  | { mode?: "workflow"; revision: number; publishedVersionId: string | null; before: VisualGraph; after: VisualGraph; operations: Operation[] }
);

export async function buildAutomationProposal(input: ProposalInput): Promise<AutomationProposal> {
  const behaviors = (input.intent?.requestedBehaviors ?? [{ description: input.request.slice(0, 500), capabilityKeys: [] }]).map(b => ({ ...b, capabilityKeys: [...b.capabilityKeys] }));
  const workflow = input.mode === "plan" ? undefined : input;
  const enforced = Boolean(workflow);
  let semanticUnavailable = false;
  let semanticFailureMessage: string | undefined;
  let semanticKeys: string[] = [];
  let semanticEvidence: WorkflowSemanticReview["evidence"] = [];
  try { const review = await reviewWorkflowSemantics(input.request, workflow?.after, behaviors);
    for (const index of review.authoringBehaviorIndexes ?? []) behaviors[index].capabilityKeys = [];
    semanticKeys = review.capabilityKeys; semanticEvidence = review.evidence; }
  catch (error) { semanticUnavailable = true; semanticFailureMessage = error instanceof WorkflowSemanticReviewError ? error.message : undefined; }
  const inferred = [...new Set([...semanticKeys, ...(workflow ? graphCapabilities(workflow.before, workflow.after) : []), ...(enforced && workflow ? graphRequirements(workflow.after).capabilityKeys : [])])];
  for (const key of inferred) if (!behaviors.some(b => b.capabilityKeys.includes(key))) behaviors.push({ description: getCapability(key)?.description ?? `Aftësi e kërkuar: ${key}`, capabilityKeys: [key] });
  let assessments: CapabilityAssessment[] = [];
  let unavailable = semanticUnavailable;
  const keys = [...new Set(behaviors.flatMap(b => b.capabilityKeys))];
  try { assessments = await assessBusinessCapabilities(input.businessId, { userId: input.userId }, { keys, ...(workflow ? { candidate: workflow.after } : {}) }); }
  catch { unavailable = true; }
  let enforcementFailure: CapabilityEnforcementError | undefined;
  if (enforced && workflow && !unavailable) {
    try { await enforceWorkflowCapabilities(input.businessId, input.userId, workflow.after, "draft"); }
    catch (error) { enforcementFailure = error instanceof CapabilityEnforcementError ? error : new CapabilityEnforcementError("unverified", "Nuk u verifikuan aftësitë e rrjedhës."); }
  }
  const capabilities = keys.map((key): CapabilityAssessment => {
    if (!getCapability(key)) return { capabilityKey: key, status: "unsupported", availability: "unsupported", reasonCode: "unknown_capability", missingRequirements: [] };
    return assessments.find(a => a.capabilityKey === key) ?? { capabilityKey: key, status: "needs_clarification", reasonCode: "assessment_unavailable", missingRequirements: ["capability_assessment"] };
  });
  const unsupportedActions = capabilities.filter(c => c.status === "unsupported").map(c => c.capabilityKey);
  if (enforced && capabilities.some(c => c.missingRequirements.some(key => key.startsWith("module:"))))
    enforcementFailure ??= new CapabilityEnforcementError("module_disabled", "Një modul i kërkuar nga propozimi është i çaktivizuar.");
  const clarificationQuestions = [...(input.intent?.clarificationQuestions ?? [])];
  if (!workflow && behaviors.some(b => !b.capabilityKeys.length)) clarificationQuestions.push("Çfarë rezultati konkret pret nga hapi që ende nuk ka një aftësi të identifikuar?");
  if (unsupportedActions.length) clarificationQuestions.push("Automatizimi i plotë nuk mbështetet. Dëshiron të kërkosh një draft vetëm për pjesën e mbështetur?");
  if (unavailable) clarificationQuestions.push("Nuk u verifikuan aftësitë e biznesit. Provo përsëri para ruajtjes.");
  else if (capabilities.some(c => c.status === "needs_clarification")) clarificationQuestions.push("Duhen sqaruar aftësitë e paverifikuara para ruajtjes.");
  const rank: CapabilityReadiness[] = ["ready", "needs_setup", "needs_clarification", "unsupported"];
  const readiness = capabilities.reduce<CapabilityReadiness>((status, c) => rank.indexOf(c.status) > rank.indexOf(status) ? c.status : status,
    clarificationQuestions.length || enforcementFailure?.code === "unverified" ? "needs_clarification" : enforcementFailure ? "needs_setup" : "ready");
  const validationFindings: AutomationProposal["validationFindings"] = workflow ? validateVisualGraph(workflow.after).errors.map(e => ({ code: "invalid_graph", message: e.message, severity: "warning" })) : [];
  if (unsupportedActions.length) validationFindings.push({ code: "unsupported_actions", message: "Këto veprime nuk kanë ekzekutim të mbështetur.", severity: "error" });
  if (semanticUnavailable) validationFindings.push({ code: "semantic_review_unavailable", message: semanticFailureMessage ?? "Nuk u verifikua kuptimi i udhëzimeve. Propozimi ruhet në bisedë; asnjë ndryshim nuk u krye.", severity: "error" });
  if (unavailable) validationFindings.push({ code: "assessment_unavailable", message: "Gatishmëria nuk u verifikua.", severity: "error" });
  if (enforcementFailure) validationFindings.push({ code: enforcementFailure.code, message: enforcementFailure.message, severity: "error" });
  const missingRequirements = [...new Set(capabilities.flatMap(c => c.missingRequirements))];
  if (missingRequirements.length) validationFindings.push({ code: "needs_setup", message: "Nevojitet konfigurim para aktivizimit.", severity: "warning" });
  return {
    // A plan is not a workflow snapshot and cannot become a save/publication ticket.
    semanticEvidence,
    version: 1, proposalId: randomUUID(), status: "proposed", readiness, baseRevision: workflow?.revision ?? 0, workflowVersionId: workflow?.publishedVersionId ?? null,
    requestedBehaviors: behaviors.map(b => ({ ...b, readiness: unavailable || clarificationQuestions.length && !b.capabilityKeys.length ? "needs_clarification" : b.capabilityKeys.reduce<CapabilityReadiness>((s, key) => {
      const next = capabilities.find(c => c.capabilityKey === key)!.status; return rank.indexOf(next) > rank.indexOf(s) ? next : s;
    }, "ready") })),
    // Blocked requests never return executable operations masquerading as a partial success.
    operations: unsupportedActions.length || clarificationQuestions.length || enforcementFailure ? [] : workflow?.operations ?? [],
    requiredCapabilities: capabilities, missingRequirements, unsupportedActions, assumptions: input.intent?.assumptions ?? [], clarificationQuestions, validationFindings,
    canSaveDraft: Boolean(workflow) && !unavailable && !enforcementFailure && !clarificationQuestions.length && !capabilities.some(c => ["unsupported", "needs_clarification"].includes(c.status)),
  };
}

export function automationMessage(proposal: AutomationProposal): string {
  const labels = { ready: "Gati", needs_setup: "Kërkon konfigurim", unsupported: "Nuk mbështetet", needs_clarification: "Kërkon sqarim" };
  return [proposal.canSaveDraft ? "Propozim për draft; ende nuk është ruajtur ose publikuar." : "Ky propozim nuk mund të ruhet ende; automatizimi i plotë nuk mund të aktivizohet.",
    ...proposal.requestedBehaviors.map(b => `${b.description}: ${labels[b.readiness]}.`),
    ...(proposal.unsupportedActions.length ? proposal.requiredCapabilities.filter(c => c.status === "ready" || c.status === "needs_setup").map(c => `Mund të propozohet veçmas (${labels[c.status]}): ${getCapability(c.capabilityKey)!.description}`) : []),
    ...proposal.clarificationQuestions,
    ...proposal.validationFindings.filter(f => f.severity === "error").map(f => f.message),
    ...(proposal.missingRequirements.length ? [`Konfigurime që mungojnë për aktivizim (jo leje për ruajtjen e draftit): ${proposal.missingRequirements.join(", ")}.`] : []),
  ].join("\n");
}

export async function recheckAutomation(businessId: string, userId: string, proposal?: AutomationProposal, candidate?: VisualGraph) {
  let current: CapabilityAssessment[];
  try { current = await assessBusinessCapabilities(businessId, { userId }, proposal ? { keys: proposal.requiredCapabilities.map(c => c.capabilityKey), ...(candidate ? { candidate } : {}) } : undefined); }
  catch { throw new AssistantError("Nuk u verifikuan aftësitë dhe qasja në biznes. Përgatite propozimin përsëri."); }
  if (!proposal) return; // Legacy tickets still recheck authorization; their graph uses the existing validator.
  if (!proposal.canSaveDraft) throw new AssistantError("Propozimi kërkon sqarim para ruajtjes.");
  for (const prior of proposal.requiredCapabilities) {
    const next = current.find(c => c.capabilityKey === prior.capabilityKey);
    if (!getCapability(prior.capabilityKey) || !next || ["unsupported", "needs_clarification"].includes(next.status) || next.status !== prior.status || JSON.stringify([...next.missingRequirements].sort()) !== JSON.stringify([...prior.missingRequirements].sort()))
      throw new AssistantError("Aftësitë ose konfigurimi ndryshuan. Përgatite propozimin përsëri.");
  }
}

export const automationInstructions = `For workflow_draft, automation_plan and automation questions return automation with every requested CUSTOMER-RUNTIME behavior, required capabilityKeys, assumptions and clarificationQuestions. Editing, saving or publishing the configuration by the owner is an authoring operation, not a runtime capability; do not invent capability keys for it. Describe a pure configuration edit with an empty capabilityKeys array. If the requested workflow itself must edit configurations during customer conversations, assess that runtime behavior honestly as unsupported. For other actions use automation=null. Readiness is computed by the server, never invent it. Include unsupported behaviors even when proposing a supported subset. product.search and product.recommend concern catalog data only, never live inventory. inventory.check, back_in_stock.notify, schedule.trigger and arbitrary external integrations are unsupported. Never encode them as knowledge prompts, collect fields, labels, new node kinds or custom conditions. If any behavior is unsupported, explain the complete automation cannot run and ask the owner to explicitly request only the supported subset; never infer consent from history. Ambiguous scope must produce clarificationQuestions and no changes. No scripts, tools or credentials in graph configuration. Existing patch operations and draft/publish rules remain unchanged.`;
