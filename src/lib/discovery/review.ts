import { emptyDraft, fields, value, withMissing, type Draft, type Fact } from "@/lib/business-intelligence/model";

export function editDiscoveryDraft(draft: Draft, edits: unknown, resolved: unknown): Draft {
  const next = structuredClone(draft);
  if (!Array.isArray(edits) || edits.length > 60) throw new Error("invalid_edits");
  for (const edit of edits) {
    const entity = next.entities.find((e) => e.id === edit?.id);
    if (!entity || !edit.values || typeof edit.values !== "object" || Array.isArray(edit.values)) throw new Error("invalid_edits");
    for (const [field, text] of Object.entries(edit.values)) {
      if (!(fields[entity.target] as readonly string[]).includes(field) || typeof text !== "string" || text.length > 8000) throw new Error("invalid_edits");
      if (value(entity, field) === text) continue;
      const conflict = next.conflicts.find((c) => c.entityId === entity.id && c.field === field && c.incoming.value === text);
      const now = new Date().toISOString();
      const fact: Fact = conflict ? { ...conflict.incoming, confirmedByUser: true, updatedAt: now } : { field, value: text.trim() || null, source: "manual", sourceRef: "discovery:review", confidence: 1, evidence: null, confirmedByUser: true, createdAt: now, updatedAt: now };
      entity.facts = entity.facts.filter((f) => f.field !== field).concat(fact);
    }
  }
  if (!Array.isArray(resolved) || resolved.some((v) => typeof v !== "string")) throw new Error("invalid_edits");
  next.conflicts = next.conflicts.filter((c) => !resolved.includes(`${c.entityId}:${c.field}`));
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
