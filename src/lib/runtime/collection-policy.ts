import type { ProfileKey } from "@/lib/workflows/context";
import type { VisualVersion, VisualRunState } from "@/lib/workflows/visual/types";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";

export type CollectionScope = {
  versionId: string; flowId: string; domain: "order" | "service" | "booking";
  mode: "existing" | "collection_only"; profileFields: ProfileKey[];
};
export type CollectionPolicy = { version: 1; revision: number; scopes: CollectionScope[] };
/** A process receipt, not permission. Always compare with the current server read. */
export type CollectionPin = CollectionScope & { revision: number; businessId: string };

export function parseCollectionPolicy(raw: unknown): CollectionPolicy | null {
  if (raw === null || raw === undefined) return null;
  const p = raw as CollectionPolicy;
  if (p.version !== 1 || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Array.isArray(p.scopes) || p.scopes.length > 100) throw blocked();
  const seen = new Set<string>();
  for (const s of p.scopes) {
    if (!s || typeof s.versionId !== "string" || typeof s.flowId !== "string" || !["order", "service", "booking"].includes(s.domain)
      || !["existing", "collection_only"].includes(s.mode) || !Array.isArray(s.profileFields)
      || s.profileFields.some(k => !["name", "phone", "email", "city", "address"].includes(k))
      || new Set(s.profileFields).size !== s.profileFields.length || s.mode === "existing" && s.profileFields.length
      || s.domain !== "order" && s.profileFields.length) throw blocked();
    const key = `${s.versionId}:${s.flowId}`;
    if (seen.has(key)) throw blocked();
    seen.add(key);
  }
  return p;
}
export function blocked() {
  return new CapabilityEnforcementError("unverified", "Politika e kësaj kërkese ndryshoi ose nuk u verifikua. Anulo kërkesën dhe nise përsëri; nuk u krye veprim biznesi.");
}

/** version.collectionPolicy is populated only by the tenant-scoped server loader. */
export function collectionForNode(version: VisualVersion, nodeId?: string, pin?: CollectionPin): CollectionPin | undefined {
  const flow = version.graph.version === 2 ? version.graph.flows.find(f => f.nodeIds.includes(nodeId ?? ""))
    ?? (pin?.versionId === version.id && version.graph.nodes.some(n => n.id === nodeId && ["end", "handoff"].includes(n.kind))
      ? version.graph.flows.find(f => f.id === pin.flowId) : undefined) : undefined;
  const config = parseCollectionPolicy(version.collectionPolicy);
  const scope = config?.scopes.find(s => s.versionId === version.id && s.flowId === flow?.id);
  const current = scope ? { ...scope, profileFields: [...scope.profileFields], revision: config!.revision, businessId: version.businessId } : undefined;
  if (pin && (pin.businessId !== version.businessId || pin.versionId === version.id && pin.flowId === flow?.id
    && (!current || pin.revision !== current.revision || pin.mode !== current.mode || pin.domain !== current.domain
      || JSON.stringify(pin.profileFields) !== JSON.stringify(current.profileFields)))) throw blocked();
  return current;
}
export function pinCollection(visual: VisualRunState, policy?: CollectionPin) {
  if (policy) visual.collection = policy;
  else delete visual.collection;
}
