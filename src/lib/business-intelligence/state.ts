import {
  emptyDraft,
  mergeDraft,
  type Draft,
  type Entity,
  type Fact,
} from "./model";
type Row = Record<string, unknown>;
export function snapshotEntities(snapshot: Record<string, unknown>): Entity[] {
  const now = new Date().toISOString();
  const fact = (field: string, value: unknown): Fact => ({
    field,
    value: value == null ? null : String(value),
    source: "manual",
    sourceRef: "platform",
    confidence: 1,
    evidence: null,
    confirmedByUser: true,
    createdAt: now,
    updatedAt: now,
  });
  const rows = (key: string) =>
    (Array.isArray(snapshot[key]) ? snapshot[key] : []) as Row[];
  const business = snapshot.business as Row;
  const profile = rows("knowledge").find(
    (k) => k.intent_key === "business_profile",
  );
  const entities: Entity[] = [
    {
      id: profile ? String(profile.id) : crypto.randomUUID(),
      target: "profile",
      facts: [
        fact("name", business.name),
        ...(profile ? [fact("description", profile.body)] : []),
      ],
    },
  ];
  entities.push(
    ...rows("products").map((p) => ({
      id: String(p.id),
      target: "product" as const,
      facts: [
        fact("name", p.name),
        fact("description", p.description),
        fact("price", p.price_amount),
        fact("currency", p.currency),
        fact("imageUrl", p.image_url),
      ],
    })),
  );
  const agents = rows("agents");
  const agent = agents.find((a) => a.is_active) ?? agents[0];
  if (agent)
    entities.push({
      id: String(agent.id),
      target: "agent",
      facts: [fact("rules", agent.instructions)],
    });
  entities.push(
    ...rows("knowledge")
      .filter((k) => k.intent_key !== "business_profile")
      .map((k) => ({
        id: String(k.id),
        target:
          k.intent_key === "service"
            ? ("service" as const)
            : ("knowledge" as const),
        facts:
          k.intent_key === "service"
            ? [fact("name", k.title), fact("description", k.body)]
            : [fact("title", k.title), fact("body", k.body)],
      })),
  );
  return entities;
}
export function seedDraft(snapshot: Record<string, unknown>): Draft {
  return mergeDraft(emptyDraft(), snapshotEntities(snapshot));
}
