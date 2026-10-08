import { emptyDraft, equivalent, normalizeDraftCurrencies, fields, targets, value, withMissing, type Draft, type Entity, type Fact, type Target } from "@/lib/business-intelligence/model";
import { isModuleId, normalizeEnabledModules } from "@/lib/dashboard/modules/dependencies";
import { generateDashboardProfile, rebuildProfileFromModules } from "@/lib/dashboard/profile/generate";
import type { DashboardProfile, DashboardSignals, ModuleId } from "@/lib/dashboard/modules/types";

export const reviewSections: { target: Target; label: string; description: string }[] = [
  { target: "profile", label: "Profili i biznesit", description: "Emri dhe informacioni bazë i biznesit." },
  { target: "product", label: "Produktet", description: "Produktet dhe çmimet e gjetura në burimet e tua." },
  { target: "service", label: "Shërbimet", description: "Shërbimet që ofron biznesi." },
  { target: "knowledge", label: "Njohuritë dhe FAQ", description: "Informacioni që Agjenti mund të përdorë në përgjigje." },
  { target: "agent", label: "Udhëzimet e Agjentit", description: "Propozime për mënyrën si përgjigjet Agjenti." },
  { target: "workflow", label: "Proceset", description: "Hapat e propozuar për bisedat dhe porositë." },
];
export const sectionModules: Partial<Record<Target, ModuleId>> = { product: "products", service: "services", knowledge: "knowledge", workflow: "workflows" };

export function editReviewPreferences(draft: Draft, input: unknown): Draft {
  if (input === undefined) return draft;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_request");
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.excludedTargets) || raw.excludedTargets.some((v) => typeof v !== "string" || !(targets as readonly string[]).includes(v) || v === "profile") || !Array.isArray(raw.excludedEntityIds) || raw.excludedEntityIds.length > 60 || raw.excludedEntityIds.some((id) => typeof id !== "string" || !draft.entities.some((e) => e.id === id))) throw new Error("invalid_request");
  if (raw.enabledModules !== undefined && (!Array.isArray(raw.enabledModules) || raw.enabledModules.length > 16 || raw.enabledModules.some((id) => typeof id !== "string" || !isModuleId(id)))) throw new Error("invalid_request");
  const excludedTargets = [...new Set(raw.excludedTargets as Target[])];
  const disabledModules = excludedTargets.map((target) => sectionModules[target]);
  return { ...draft, reviewPreferences: { excludedTargets, excludedEntityIds: [...new Set(raw.excludedEntityIds as string[])], ...(raw.enabledModules === undefined ? {} : { enabledModules: normalizeEnabledModules((raw.enabledModules as ModuleId[]).filter((id) => !disabledModules.includes(id))) }) } };
}

export function reviewEntityEnabled(entity: Entity, draft: Draft) {
  const preferences = draft.reviewPreferences;
  const moduleId = sectionModules[entity.target];
  return !preferences?.excludedTargets.includes(entity.target) && !preferences?.excludedEntityIds.includes(entity.id) && (!moduleId || !preferences?.enabledModules || preferences.enabledModules.includes(moduleId));
}

export function reviewDashboardProfile(draft: Draft, signals: DashboardSignals, prior: DashboardProfile | null): DashboardProfile {
  const base = prior ? { ...prior, signals } : generateDashboardProfile(signals);
  if (!draft.reviewPreferences) return base;
  const disabled = draft.reviewPreferences.excludedTargets.map((target) => sectionModules[target]);
  return rebuildProfileFromModules((draft.reviewPreferences.enabledModules ?? base.enabledModules).filter((id) => !disabled.includes(id)), signals);
}

export type DiscoveryConflictGroup = { key: string; entityId: string; field: string; current: Fact; alternatives: Fact[] };

export function discoveryConflictGroups(draft: Draft, selected?: readonly string[], resolved: readonly string[] = []): DiscoveryConflictGroup[] {
  const groups = new Map<string, DiscoveryConflictGroup>();
  for (const conflict of draft.conflicts) {
    const key = `${conflict.entityId}:${conflict.field}`;
    if (resolved.includes(key) || (selected && !selected.includes(conflict.entityId))) continue;
    const entity = draft.entities.find((e) => e.id === conflict.entityId);
    if (!entity) continue;
    const current = entity.facts.find((f) => f.field === conflict.field) ?? conflict.current;
    if (equivalent(current.value, conflict.incoming.value)) continue;
    const group = groups.get(key) ?? { key, entityId: entity.id, field: conflict.field, current, alternatives: [] };
    if (!group.alternatives.some((f) => equivalent(f.value, conflict.incoming.value))) group.alternatives.push(conflict.incoming);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function editDiscoveryDraft(draft: Draft, edits: unknown, resolved: unknown): Draft {
  const next = structuredClone(draft);
  if (!Array.isArray(resolved) || resolved.some((v) => typeof v !== "string")) throw new Error("invalid_edits");
  const decisions = new Set<string>(resolved);
  if (!Array.isArray(edits) || edits.length > 60) throw new Error("invalid_edits");
  for (const edit of edits) {
    const entity = next.entities.find((e) => e.id === edit?.id);
    if (!entity || !edit.values || typeof edit.values !== "object" || Array.isArray(edit.values)) throw new Error("invalid_edits");
    for (const [field, text] of Object.entries(edit.values)) {
      if (!(fields[entity.target] as readonly string[]).includes(field) || typeof text !== "string" || text.length > 8000) throw new Error("invalid_edits");
      // An explicit correction is also a decision on competing source values.
      decisions.add(`${entity.id}:${field}`);
      if (value(entity, field) === text) continue;
      const conflict = next.conflicts.find((c) => c.entityId === entity.id && c.field === field && c.incoming.value === text);
      const now = new Date().toISOString();
      const fact: Fact = conflict ? { ...conflict.incoming, confirmedByUser: true, updatedAt: now } : { field, value: text.trim() || null, source: "manual", sourceRef: "discovery:review", confidence: 1, evidence: null, confirmedByUser: true, createdAt: now, updatedAt: now };
      entity.facts = entity.facts.filter((f) => f.field !== field).concat(fact);
    }
  }
  for (const entity of next.entities) for (const fact of entity.facts) {
    if (decisions.has(`${entity.id}:${fact.field}`)) {
      fact.confirmedByUser = true;
      fact.updatedAt = new Date().toISOString();
    }
  }
  next.conflicts = next.conflicts.filter((c) => !decisions.has(`${c.entityId}:${c.field}`));
  return normalizeDraftCurrencies(next);
}

export function canApplyEntity(draft: Draft, id: string) {
  const entity = draft.entities.find((e) => e.id === id);
  return Boolean(entity && !withMissing({ ...emptyDraft(), entities: [entity] }).missingInformation.length);
}

export function jobProgress(stage: string, nextImage = 0, imageCount = 0, nextText = 0, textLength = 0) {
  if (stage === "done") return 100;
  if (stage === "finish") return 95;
  if (stage === "images") return 30 + Math.round(60 * Math.min(1, nextImage / Math.max(1, imageCount)));
  return stage === "text" ? 20 + Math.round(10 * Math.min(1, nextText / Math.max(1, textLength))) : 5;
}
