import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeVisualDraft } from "./model";
import { loadVisualVersion } from "./store";
import type { VisualGraph } from "./types";

export type VisualFlowChoice = {
  id: string; name: string; status: string;
  inDraft: boolean; steps: { key: string; label: string }[];
  productIds: string[]; publishedProductIds: string[];
};
export type VisualFlowChoices = { revision: number; flows: VisualFlowChoice[] };
/** Shared by memory and product pickers. Never turn generated starter graphs into saved flows. */
export function flowChoices(draft: VisualGraph | null, published: VisualGraph | null, enabled: boolean): VisualFlowChoice[] {
  const drafts = draft?.version === 2 ? draft.flows : [];
  const live = published?.version === 2 ? published.flows : [];
  return [...new Set([...drafts, ...live].map(f => f.id))].map(id => {
    const d = drafts.find(f => f.id === id), p = live.find(f => f.id === id), flow = d ?? p!;
    const nodes = [...(draft?.nodes ?? []).filter(n => d?.nodeIds.includes(n.id)), ...(published?.nodes ?? []).filter(n => p?.nodeIds.includes(n.id))];
    const changed = d && p && (JSON.stringify(d) !== JSON.stringify(p) || JSON.stringify(draft?.nodes.filter(n => d.nodeIds.includes(n.id))) !== JSON.stringify(published?.nodes.filter(n => p.nodeIds.includes(n.id))));
    const status = p ? `${enabled ? "Aktiv" : "Publikuar · joaktiv"}${changed ? " · ndryshime draft" : ""}` : "Draft";
    return { id, name: flow.label, status, inDraft: Boolean(d),
      steps: [...new Map(nodes.map(n => [n.id, { key: n.id, label: n.label }])).values()],
      productIds: d?.productIds ?? [], publishedProductIds: p?.productIds ?? [] };
  });
}
export async function loadVisualFlowChoices(businessId: string): Promise<VisualFlowChoices> {
  const { data, error } = await createServiceSupabase().from("visual_workflows").select("draft,revision,published_version_id,enabled").eq("business_id", businessId).maybeSingle();
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error("Nuk u ngarkuan rrjedhat vizuale.");
  if (!data) return { revision: 0, flows: [] };
  const draft = normalizeVisualDraft(data.draft);
  if (!draft) throw new Error("Drafti i rrjedhës nuk është i vlefshëm.");
  const published = data.published_version_id ? await loadVisualVersion(businessId, data.published_version_id) : null;
  return { revision: data.revision, flows: flowChoices(draft, published?.graph ?? null, Boolean(data.enabled)) };
}
