import { withMissing, type Draft, type Entity } from "@/lib/business-intelligence/model";
import { basicInstructions, initialInstructions } from "@/lib/onboarding/model";
import { answersFor } from "./proposal";
import { reviewDashboardProfile } from "./review";
import { parseDashboardProfile } from "@/lib/dashboard/profile/service";
import type { DashboardSignals } from "@/lib/dashboard/modules/types";

// Source discovery is business context. Catalog imports use a separate flow.
export function businessContext(entities: Entity[]) {
  return entities.filter(entity => entity.target === "profile" || entity.target === "knowledge");
}
export function contextDraft(draft: Draft): Draft {
  const entities = businessContext(draft.entities);
  return withMissing({ ...draft, entities, conflicts: draft.conflicts.filter(conflict => entities.some(entity => entity.id === conflict.entityId)) });
}

export function manualContextSignals(baseline: Record<string, unknown>) {
  const raw = (baseline.business as { dashboard_profile?: unknown }).dashboard_profile as { source?: string } | undefined;
  return raw?.source === "manual" ? parseDashboardProfile(raw)?.signals ?? null : null;
}

export function automaticSetup(draft: Draft, signals: DashboardSignals, baseline: Record<string, unknown>) {
  const business = baseline.business as { name: string; dashboard_profile?: unknown };
  const raw = business.dashboard_profile as { source?: string } | undefined;
  const prior = raw?.source === "manual" ? parseDashboardProfile(raw) : null;
  const answers = { ...answersFor(business.name, signals, contextDraft(draft)), onboardingMode: "sources" as const };
  const agents = (baseline.agents ?? []) as { id: string; is_active: boolean; instructions: string }[];
  const starter = agents.find(agent => !agent.is_active && agent.instructions === basicInstructions(business.name));
  const agent = agents.some(agent => agent.is_active) || (agents.length > 0 && !starter) ? null : {
    id: starter?.id ?? crypto.randomUUID(),
    expectedInstructions: starter?.instructions ?? null,
    // Descriptions are source material, not user-confirmed commands. They are
    // available through Knowledge; generated instructions contain platform rules.
    instructions: initialInstructions({ ...answers, details: answers.details ? { ...answers.details, businessDescription: null } : undefined }),
  };
  return {
    profile: reviewDashboardProfile(draft, signals, prior?.source === "manual" ? prior : null),
    answers,
    agent,
  };
}

export function profileKnowledge(draft: Draft): Entity[] {
  const profile = draft.entities.find(entity => entity.target === "profile");
  if (!profile) return [];
  const names: Record<string, string> = { description: "Rreth biznesit", contact: "Kontakti i biznesit", shipping: "Transporti", returns: "Kthimet", policies: "Politikat e biznesit" };
  return Object.entries(names).flatMap(([field, title]) => {
    const fact = profile.facts.find(fact => fact.field === field);
    // Contradictions and image-only descriptions are not silently published.
    if (!fact?.value || !fact.evidence || !["website", "instagram"].includes(fact.source) || fact.evidenceKind === "visual" || draft.conflicts.some(conflict => conflict.entityId === profile.id && conflict.field === field)) return [];
    return [{ id: crypto.randomUUID(), target: "knowledge" as const, facts: [
      { ...fact, field: "title", value: title }, { ...fact, field: "body" },
    ] }];
  });
}
