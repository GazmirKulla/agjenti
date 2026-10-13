import { randomUUID } from "node:crypto";
import { assessBusinessCapabilities } from "@/lib/capabilities/assessment";
import { getCapability, type CapabilityAssessment, type CapabilityReadiness } from "@/lib/capabilities/registry";
import { validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import type { Operation } from "./workflow";
import { AssistantError } from "./model";

import type { AutomationIntent } from "./automation-intent";
export type AutomationProposal = {
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

/** A bounded backstop for known unsupported requests; not a general language parser. */
export function unsupportedRequestKeys(text: string): string[] {
  const value = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const keys: string[] = [];
  if (/\binventory\b|\bstok\w*|\b(?:check|track|monitor)\s+(?:the\s+)?stock\b|back.in.stock/.test(value)) keys.push("inventory.check");
  if (/back.in.stock|(?:notify|njoft)\w*[\s\S]*(?:stock|stok|rikthe|gjendje)/.test(value)) keys.push("back_in_stock.notify");
  // Scheduling a booking is supported; a future/recurrent automation trigger is not.
  if (/\bcron\b|\b(?:every (?:day|week|month|hour)|cdo (?:dite|jave|muaj|ore))\b|\b(?:schedule[ds]?|planifik\w*)\s+(?:(?:a|an|the|nje)\s+)?(?:automation|workflow|notification|message|email|job|task|action|automatizim\w*|njoft\w*|mesazh\w*|detyr\w*|veprim\w*)\b/.test(value)) keys.push("schedule.trigger");
  return keys;
}

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
      keys.push(...unsupportedRequestKeys(flow.label));
    }
  }
  for (const node of after.nodes) {
    if (!affected.has(node.id) && JSON.stringify(before.nodes.find(n => n.id === node.id)) === JSON.stringify(node)) continue;
    const key = { knowledge: "knowledge.answer", product: "product.search", booking: "booking.create", order_status: "order.status.read", handoff: "staff.handoff" }[node.kind as string];
    if (key) keys.push(key);
    keys.push(...unsupportedRequestKeys(`${node.label} ${node.config.prompt ?? ""} ${node.config.fieldKey ?? ""} ${node.config.value ?? ""}`));
  }
  return keys;
}

export async function buildAutomationProposal(input: {
  businessId: string; userId: string; revision: number; publishedVersionId: string | null;
  request: string; intent?: AutomationIntent; before: VisualGraph; after: VisualGraph; operations: Operation[];
}): Promise<AutomationProposal> {
  const behaviors = [...(input.intent?.requestedBehaviors ?? [{ description: input.request.slice(0, 500), capabilityKeys: [] }])];
  const inferred = [...new Set([...unsupportedRequestKeys(input.request), ...graphCapabilities(input.before, input.after)])];
  for (const key of inferred) if (!behaviors.some(b => b.capabilityKeys.includes(key))) behaviors.push({ description: getCapability(key)?.description ?? `Aftësi e kërkuar: ${key}`, capabilityKeys: [key] });
  let assessments: CapabilityAssessment[] = [];
  let unavailable = false;
  try { assessments = await assessBusinessCapabilities(input.businessId, { userId: input.userId }); }
  catch { unavailable = true; }
  const keys = [...new Set(behaviors.flatMap(b => b.capabilityKeys))];
  const capabilities = keys.map((key): CapabilityAssessment => {
    if (!getCapability(key)) return { capabilityKey: key, status: "unsupported", reasonCode: "unknown_capability", missingRequirements: [] };
    return assessments.find(a => a.capabilityKey === key) ?? { capabilityKey: key, status: "needs_clarification", reasonCode: "assessment_unavailable", missingRequirements: ["capability_assessment"] };
  });
  const unsupportedActions = capabilities.filter(c => c.status === "unsupported").map(c => c.capabilityKey);
  const clarificationQuestions = [...(input.intent?.clarificationQuestions ?? [])];
  if (unsupportedActions.length) clarificationQuestions.push("Automatizimi i plotë nuk mbështetet. Dëshiron të kërkosh një draft vetëm për pjesën e mbështetur?");
  if (unavailable) clarificationQuestions.push("Nuk u verifikuan aftësitë e biznesit. Provo përsëri para ruajtjes.");
  else if (capabilities.some(c => c.status === "needs_clarification")) clarificationQuestions.push("Duhen sqaruar aftësitë e paverifikuara para ruajtjes.");
  const rank: CapabilityReadiness[] = ["ready", "needs_setup", "needs_clarification", "unsupported"];
  const readiness = capabilities.reduce<CapabilityReadiness>((status, c) => rank.indexOf(c.status) > rank.indexOf(status) ? c.status : status,
    clarificationQuestions.length ? "needs_clarification" : "ready");
  const validationFindings: AutomationProposal["validationFindings"] = validateVisualGraph(input.after).errors.map(e => ({ code: "invalid_graph", message: e.message, severity: "warning" }));
  if (unsupportedActions.length) validationFindings.push({ code: "unsupported_actions", message: "Këto veprime nuk kanë ekzekutim të mbështetur.", severity: "error" });
  if (unavailable) validationFindings.push({ code: "assessment_unavailable", message: "Gatishmëria nuk u verifikua.", severity: "error" });
  const missingRequirements = [...new Set(capabilities.flatMap(c => c.missingRequirements))];
  if (missingRequirements.length) validationFindings.push({ code: "needs_setup", message: "Nevojitet konfigurim para aktivizimit.", severity: "warning" });
  return {
    version: 1, proposalId: randomUUID(), status: "proposed", readiness, baseRevision: input.revision, workflowVersionId: input.publishedVersionId,
    requestedBehaviors: behaviors.map(b => ({ ...b, readiness: unavailable || clarificationQuestions.length && !b.capabilityKeys.length ? "needs_clarification" : b.capabilityKeys.reduce<CapabilityReadiness>((s, key) => {
      const next = capabilities.find(c => c.capabilityKey === key)!.status; return rank.indexOf(next) > rank.indexOf(s) ? next : s;
    }, "ready") })),
    // Blocked requests never return executable operations masquerading as a partial success.
    operations: unsupportedActions.length || clarificationQuestions.length ? [] : input.operations,
    requiredCapabilities: capabilities, missingRequirements, unsupportedActions, assumptions: input.intent?.assumptions ?? [], clarificationQuestions, validationFindings,
    canSaveDraft: !unavailable && !clarificationQuestions.length && !capabilities.some(c => ["unsupported", "needs_clarification"].includes(c.status)),
  };
}

export function automationMessage(proposal: AutomationProposal): string {
  const labels = { ready: "Gati", needs_setup: "Kërkon konfigurim", unsupported: "Nuk mbështetet", needs_clarification: "Kërkon sqarim" };
  return [proposal.canSaveDraft ? "Propozim për draft; ende nuk është ruajtur ose publikuar." : "Ky propozim nuk mund të ruhet ende; automatizimi i plotë nuk mund të aktivizohet.",
    ...proposal.requestedBehaviors.map(b => `${b.description}: ${labels[b.readiness]}.`),
    ...(proposal.unsupportedActions.length ? proposal.requiredCapabilities.filter(c => c.status === "ready" || c.status === "needs_setup").map(c => `Mund të propozohet veçmas (${labels[c.status]}): ${getCapability(c.capabilityKey)!.description}`) : []),
    ...proposal.clarificationQuestions,
    ...(proposal.missingRequirements.length ? [`Konfigurime që mungojnë: ${proposal.missingRequirements.join(", ")}.`] : []),
  ].join("\n");
}

export async function recheckAutomation(businessId: string, userId: string, proposal?: AutomationProposal) {
  let current: CapabilityAssessment[];
  try { current = await assessBusinessCapabilities(businessId, { userId }); }
  catch { throw new AssistantError("Nuk u verifikuan aftësitë dhe qasja në biznes. Përgatite propozimin përsëri."); }
  if (!proposal) return; // Legacy tickets still recheck authorization; their graph uses the existing validator.
  if (!proposal.canSaveDraft) throw new AssistantError("Propozimi kërkon sqarim para ruajtjes.");
  for (const prior of proposal.requiredCapabilities) {
    const next = current.find(c => c.capabilityKey === prior.capabilityKey);
    if (!getCapability(prior.capabilityKey) || !next || ["unsupported", "needs_clarification"].includes(next.status) || next.status !== prior.status || JSON.stringify([...next.missingRequirements].sort()) !== JSON.stringify([...prior.missingRequirements].sort()))
      throw new AssistantError("Aftësitë ose konfigurimi ndryshuan. Përgatite propozimin përsëri.");
  }
}

export const automationInstructions = `For workflow_draft and automation questions return automation with every requested behavior, required capabilityKeys, assumptions and clarificationQuestions. For other actions use automation=null. Readiness is computed by the server, never invent it. Include unsupported behaviors even when proposing a supported subset. product.search and product.recommend concern catalog data only, never live inventory. inventory.check, back_in_stock.notify, schedule.trigger and arbitrary external integrations are unsupported. Never encode them as knowledge prompts, collect fields, labels, new node kinds or custom conditions. If any behavior is unsupported, explain the complete automation cannot run and ask the owner to explicitly request only the supported subset; never infer consent from history. Ambiguous scope must produce clarificationQuestions and no changes. No scripts, tools or credentials in graph configuration. Existing patch operations and draft/publish rules remain unchanged.`;
