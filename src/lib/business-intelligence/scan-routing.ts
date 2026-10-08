import { withMissing, value, type Draft, type Entity } from "./model";

// Only source-backed, complete website/Instagram entries are routed automatically.
// Manual knowledge and the user's explicit exclusions remain authoritative.
export function scanKnowledge(draft: Draft): Entity[] {
  const preferences = draft.reviewPreferences;
  if (preferences?.excludedTargets.includes("knowledge") || (preferences?.enabledModules && !preferences.enabledModules.includes("knowledge"))) return [];
  const supported = (entity: Entity) => entity.target === "knowledge" && ["title", "body"].every(field => {
    const fact = entity.facts.find(f => f.field === field);
    return Boolean(fact?.value?.trim() && ["website", "instagram"].includes(fact.source) && fact.evidence?.trim() && fact.evidenceKind !== "visual");
  });
  const candidates = draft.entities.filter(entity => !preferences?.excludedEntityIds.includes(entity.id) && supported(entity));
  const groups = new Map<string, Entity[]>();
  for (const entity of candidates) {
    const alternatives = draft.conflicts.filter(conflict => conflict.entityId === entity.id && ["title", "body"].includes(conflict.field)).map(conflict => ({ ...entity, id: crypto.randomUUID(), facts: entity.facts.filter(fact => fact.field !== conflict.field).concat(conflict.incoming) })).filter(supported);
    const title = value(entity, "title").trim().toLocaleLowerCase();
    groups.set(title, [...(groups.get(title) ?? []), entity, ...alternatives]);
  }
  // Keep each answer and its alternatives together so removing a routed entry
  // cannot discard a competing answer at the transaction's batch limit.
  const routed: Entity[] = [];
  for (const group of groups.values()) if (routed.length + group.length <= 60) routed.push(...group);
  return routed;
}

export function withoutScanKnowledge(draft: Draft, knowledge: Entity[]): Draft {
  const ids = new Set(draft.entities.filter(entity => knowledge.some(item => item.id === entity.id || (entity.target === "knowledge" && value(entity, "title").trim().toLocaleLowerCase() === value(item, "title").trim().toLocaleLowerCase() && entity.facts.every(fact => !fact.confirmedByUser)))).map(entity => entity.id));
  return withMissing({ ...draft, entities: draft.entities.filter(entity => !ids.has(entity.id)), conflicts: draft.conflicts.filter(conflict => !ids.has(conflict.entityId)), ...(draft.reviewPreferences ? { reviewPreferences: { ...draft.reviewPreferences, excludedEntityIds: draft.reviewPreferences.excludedEntityIds.filter(id => !ids.has(id)) } } : {}) });
}

export function reviewEntities(draft: Draft, target?: Entity["target"]) {
  return draft.entities.filter(entity => target ? entity.target === target : entity.target !== "knowledge");
}

export function knowledgeNotice(count: number) {
  return count === 1 ? "1 njohuri u dërgua te moduli Njohuritë." : `${count} njohuri u dërguan te moduli Njohuritë.`;
}
