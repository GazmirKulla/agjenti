import { assistantSuggestions, type AssistantUIContext } from "@/lib/business-assistant/context";
import type { ActionPlanStep } from "@/lib/business-assistant/action-plan";
import type { CapabilityActivationResult } from "@/lib/business-assistant/activation-contract";

export const uncertainActivation = "Ndryshimi mund të jetë ruajtur, por nuk arritëm ta verifikojmë. Kontrollo gjendjen përpara se ta provosh përsëri.";
export type ActivationFeedback = { label: string; message: string; unverified: boolean };

/** Display evidence, not HTTP success. This never authorizes or executes an action. */
export function activationFeedback(result: CapabilityActivationResult, capability: string): ActivationFeedback {
  const assessment = result.assessment;
  const ready = assessment?.capabilityKey === capability && assessment.status === "ready" &&
    (!assessment.availability || assessment.availability === "ready") && assessment.missingRequirements?.length === 0;
  if (result.status === "unverified" && result.changed === false) {
    return { label: "Nuk u verifikua", message: result.message, unverified: true };
  }
  if (result.status === "unverified" || result.status === "activated" && !(result.changed === true && ready) ||
    result.status === "ready" && !(result.changed === false && ready)) {
    return { label: "Nuk u verifikua", message: uncertainActivation, unverified: true };
  }
  const labels: Record<CapabilityActivationResult["status"], string> = {
    available: "Kërkon konfigurim", ready: "Tashmë gati", disabled: "Kërkon konfigurim",
    unauthorized: "Nuk ke leje për këtë ndryshim", unsupported: "Nuk mbështetet",
    blocked: "Kërkon konfigurim", activated: "U përfundua", unverified: "Nuk u verifikua",
  };
  const known = Object.hasOwn(labels, result.status);
  return { label: known ? labels[result.status] : "Nuk u verifikua", message: known ? result.message : uncertainActivation, unverified: !known };
}

export function isUnsupportedStep(step: ActionPlanStep) {
  return step.readiness === "UNSUPPORTED" || step.requiredCapability !== null && !step.supported;
}

export function planStepLabel(step: ActionPlanStep, decision?: "approved" | "rejected", unverified = false) {
  if (isUnsupportedStep(step)) return "Nuk mbështetet";
  if (unverified) return "Nuk u verifikua";
  if (decision === "rejected") return "Lënë jashtë planit";
  if (decision === "approved" && step.readiness === "READY") return "Përfshirë vetëm në plan";
  if (step.readiness === "READY") return "Propozuar";
  if (step.readiness === "BLOCKED") return step.requiredDecision ? "Kërkon sqarim" : "Nuk u verifikua";
  return "Kërkon konfigurim";
}

/** Presentation only: server capability and authorization checks remain authoritative. */
export function contextualAction(context: AssistantUIContext, name: string, modules: string[]) {
  const page = context.page;
  if (!modules.includes(page)) return null;
  switch (page) {
    case "products": return `Pyet ${name} për ${context.entityId ? "këtë produkt" : context.selectedEntityIds?.length ? "produktet e zgjedhura" : "produktet"}`;
    case "services": return context.entityId ? `Ndrysho këtë shërbim me ${name}` : `Pyet ${name} për shërbimet`;
    case "knowledge": return `Përditëso njohuritë me ${name}`;
    case "agents": return `Ndihmë me agjentin e klientëve · ${name}`;
    case "workflows": return `Ndihmë me këtë rrjedhë · ${name}`;
    default: return `Pyet ${name} për këtë faqe`;
  }
}

export function businessGoals(context: AssistantUIContext, modules: string[], external: boolean) {
  if (context.page !== "home") return assistantSuggestions(context, modules, external);
  return [
    { module: "products", label: "Përgatit ofertën time", text: "Dua të shtoj një produkt të ri.", blocked: external },
    { module: "services", label: "Përditëso shërbimet", text: "Dua të përditësoj shërbimet e biznesit." },
    { module: "knowledge", label: "Përgjigju pyetjeve të klientëve", text: "Dua të përditësoj njohuritë e biznesit për pyetjet e klientëve." },
    { module: "agents", label: "Përmirëso komunikimin me klientët", text: "Dua të përditësoj udhëzimet e agjentit të klientëve." },
  ].filter(goal => modules.includes(goal.module) && !goal.blocked);
}
