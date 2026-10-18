import { capabilityFinding } from "@/lib/capabilities/diagnostics";
import { getCapability, type CapabilityAssessment, type CapabilityReadiness } from "@/lib/capabilities/registry";
import type { AutomationProposal } from "./automation-proposal";
import { moduleRegistry } from "@/lib/dashboard/modules/registry";
import type { ModuleId } from "@/lib/dashboard/modules/types";

export type ActionPlanReadiness = "READY" | "NEEDS_CONFIGURATION" | "DISABLED" | "UNSUPPORTED" | "BLOCKED";
export type ActionPlanStep = {
  id: string;
  title: string;
  description: string;
  requestedBehavior: string;
  requiredCapability: string | null;
  /** Actual assessment, independent of the model's business clarification questions. */
  capabilityReadiness: CapabilityReadiness | null;
  /** Review status of this plan step; a ready capability may still need a business decision. */
  readiness: ActionPlanReadiness;
  missingConfiguration: string[];
  requiredDecision: string | null;
  proposedAction: string;
  approvalRequired: boolean;
  supported: boolean;
  reasonCode: string;
};
export type ActionPlan = {
  id: string;
  request: string;
  assessedAt: string;
  steps: ActionPlanStep[];
  questions: string[];
  assumptions: string[];
};

// Presentation labels only; support and readiness always come from the registry/assessment.
const titles: Record<string, string> = {
  "knowledge.answer": "Përgjigje për klientët",
  "product.search": "Kërkim produktesh",
  "product.recommend": "Sugjerime produktesh",
  "order.prepare": "Përgatitje porosish për stafin",
  "order.status.read": "Informim për statusin e porosisë",
  "booking.availability.read": "Kontroll i orareve të lira",
  "booking.create": "Rezervim takimesh",
  "staff.handoff": "Kalimi i bisedës te stafi",
  "business.provision": "Krijim biznesi me ftesë",
};

function readinessFor(assessment: CapabilityAssessment | undefined, known: boolean): ActionPlanReadiness {
  if (!known || assessment?.status === "unsupported") return "UNSUPPORTED";
  if (!assessment || assessment.status === "needs_clarification" || assessment.availability === "unverified" ||
    assessment.availability === "integration_unavailable" ||
    assessment.missingRequirements.some(r => ["business_provision_automation_permission", "action_catalog_unavailable", "capability_assessment"].includes(r))) return "BLOCKED";
  if (assessment.availability === "module_disabled" || assessment.missingRequirements.some(r => r.startsWith("module:"))) return "DISABLED";
  if (assessment.status === "needs_setup" || assessment.missingRequirements.length) return "NEEDS_CONFIGURATION";
  return "READY";
}

/** UI projection only. The supplied assessment comes from the authenticated server action. */
export function refreshPlanCapability(plan: ActionPlan, assessment: CapabilityAssessment): ActionPlan {
  return { ...plan, assessedAt: new Date().toISOString(), steps: plan.steps.map(step => {
    if (step.requiredCapability !== assessment.capabilityKey) return step;
    const status = readinessFor(assessment, Boolean(getCapability(assessment.capabilityKey)));
    return { ...step, capabilityReadiness: assessment.status, readiness: status === "READY" && plan.questions.length ? "BLOCKED" : status,
      reasonCode: assessment.reasonCode,
      missingConfiguration: assessment.missingRequirements.map(requirement => capabilityFinding({ ...assessment, missingRequirements: [requirement] }).remediation!),
      proposedAction: status === "READY" ? "Aftësia është gati sipas kontrollit të fundit. Ky rezultat nuk ekzekuton veprime biznesi ose publikon workflow." : step.proposedAction };
  }) };
}

/** Read-only presentation of an existing server-assessed proposal, never an execution ticket. */
export function toActionPlan(proposal: AutomationProposal, request: string, questions: string[]): ActionPlan {
  return {
    id: proposal.proposalId, request, assessedAt: new Date().toISOString(),
    questions, assumptions: proposal.assumptions,
    steps: proposal.requestedBehaviors.flatMap((behavior, index) => (behavior.capabilityKeys.length ? behavior.capabilityKeys : [null]).map((key, keyIndex) => {
      const definition = key ? getCapability(key) : undefined;
      const assessment = proposal.requiredCapabilities.find(c => c.capabilityKey === key);
      const assessedStatus = key ? readinessFor(assessment, Boolean(definition)) : "BLOCKED";
      const readiness = assessedStatus === "READY" && questions.length ? "BLOCKED" : assessedStatus;
      const supported = Boolean(definition) && assessment?.status !== "unsupported";
      const diagnostic = assessment ? capabilityFinding(assessment) : undefined;
      const missingConfiguration = assessment?.missingRequirements.map(requirement => {
        const moduleId = requirement.startsWith("module:") ? requirement.slice(7) : "";
        return Object.hasOwn(moduleRegistry, moduleId)
          ? `Funksioni “${moduleRegistry[moduleId as ModuleId].label}” duhet të jetë aktiv, nëse lejohet nga paketa dhe roli yt.`
          : capabilityFinding({ ...assessment, missingRequirements: [requirement] }).remediation!;
      }) ?? [];
      return {
        id: `${index}-${keyIndex}`, title: definition ? titles[definition.key] ?? definition.description : key ? "Veprim i pambështetur" : "Hap që kërkon sqarim",
        description: definition?.description ?? (key ? "Ky veprim nuk ka ekzekutim të mbështetur. Nuk mund të aktivizohet nga ky plan." : "Nuk është identifikuar një aftësi për këtë kërkesë."),
        requestedBehavior: behavior.description === `Aftësi e kërkuar: ${key}` ? request : behavior.description,
        requiredCapability: key, capabilityReadiness: assessment?.status ?? null, readiness,
        missingConfiguration,
        requiredDecision: questions.length ? questions.join(" ") : !key ? "Çfarë rezultati konkret pret nga ky hap?" :
          readiness === "READY" ? null : readiness === "UNSUPPORTED" ? "Dëshiron ta heqësh këtë hap dhe të shqyrtosh vetëm pjesën e mbështetur?" : null,
        proposedAction: readiness === "READY" ? "Përfshije këtë hap në planin për konfigurim të mëvonshëm." :
          readiness === "UNSUPPORTED" ? "Hiqe nga plani ose kërko një alternativë të mbështetur." :
          missingConfiguration.length ? "Rishiko kërkesat e listuara dhe kërko rivlerësim. Ky plan nuk ndryshon konfigurimin ose lejet." : "Sqaro kërkesën dhe kërko një vlerësim të ri.",
        approvalRequired: supported, supported,
        reasonCode: diagnostic?.reasonCode ?? "clarification_required",
      };
    })),
  };
}

export const actionPlanInstructions = `For natural-language business goals about what the customer-facing agent should do, use automation_plan with id null, changes [], and automation listing EVERY requested behavior. This is one read-only PLAN containing multiple steps, not multiple mutations. Do not load or generate a workflow graph for this action. Ask only unresolved business decisions in automation.clarificationQuestions; do not ask owners for technical graph details. Use the existing capability definitions and current server assessments in data.capabilities; readiness and authorization are server-owned. Unknown capabilities must remain explicit unknown keys, never relabel them as a known capability. In particular customer.create, lead.capture, quote.create and order.create are not supported by this capability registry. business.provision creates a business invitation, NOT a customer or a lead. order.prepare only prepares confirmed details for staff, NOT automatic order creation or delivery. Do not force orders on a salon or bookings on an information-only business. Planning is available even when modules are disabled. Card approval is only a local planning preference, never permission to mutate, activate or publish. Existing explicit single-record edits and explicit advanced workflow commands retain their existing actions and confirmation rules.`;
