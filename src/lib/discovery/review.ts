import { emptyDraft, equivalent, fields, value, withMissing, type Draft, type Fact } from "@/lib/business-intelligence/model";

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
  return withMissing(next);
}

export function canApplyEntity(draft: Draft, id: string) {
  const entity = draft.entities.find((e) => e.id === id);
  return Boolean(entity && !withMissing({ ...emptyDraft(), entities: [entity] }).missingInformation.length);
}

export function jobProgress(stage: string, nextImage = 0, imageCount = 0) {
  if (stage === "done") return 100;
  if (stage === "finish") return 95;
  if (stage === "images") return 30 + Math.round(60 * Math.min(1, nextImage / Math.max(1, imageCount)));
  return stage === "text" ? 20 : 5;
}
