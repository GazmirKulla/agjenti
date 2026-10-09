import { createServiceSupabase } from "@/lib/supabase/service";
import { loadBusinessProcess } from "@/lib/discovery/load-process";
import { normalizeVisualDraft, starterVisualGraph, validateVisualGraph } from "./model";
import type { VisualVersion, VisualWorkspace } from "./types";

function missingTable(error: { code?: string } | null) {
  return error && ["42P01", "PGRST205"].includes(error.code ?? "");
}

export async function loadVisualWorkspace(businessId: string): Promise<VisualWorkspace> {
  const { data, error } = await createServiceSupabase().from("visual_workflows")
    .select("draft,revision,published_version_id,enabled").eq("business_id", businessId).maybeSingle();
  if (error && !missingTable(error)) throw new Error("Nuk u ngarkua rrjedha.");
  const graph = data ? normalizeVisualDraft(data.draft) : null;
  if (data && !graph) throw new Error("Drafti i ruajtur nuk është i vlefshëm.");
  const published = data?.published_version_id ? await loadVisualVersion(businessId, data.published_version_id) : null;
  return {
    hasUnpublishedChanges: Boolean(published && JSON.stringify(graph) !== JSON.stringify(published.graph)),
    graph: graph ?? starterVisualGraph((await loadBusinessProcess(businessId)).process),
    revision: data?.revision ?? 0, publishedVersionId: data?.published_version_id ?? null,
    enabled: data?.enabled ?? false, available: !error, generated: !data,
  };
}

/** Running conversations keep their immutable published version, including after a new publish. */
export async function loadVisualVersion(businessId: string, pinnedId?: string | null): Promise<VisualVersion | null> {
  const db = createServiceSupabase();
  let id = pinnedId;
  if (!id) {
    const { data, error } = await db.from("visual_workflows").select("published_version_id,enabled")
      .eq("business_id", businessId).maybeSingle();
    if (missingTable(error)) return null;
    if (error) throw new Error("Nuk u ngarkua rrjedha aktive.");
    if (!data?.enabled || !data.published_version_id) return null;
    id = data.published_version_id;
  }
  const { data, error } = await db.from("visual_workflow_versions").select("id,graph,created_at")
    .eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Versioni i rrjedhës nuk është i disponueshëm.");
  const { graph } = validateVisualGraph(data.graph);
  if (!graph) throw new Error("Rrjedha aktive nuk është e vlefshme.");
  return { id: data.id, businessId, graph, createdAt: data.created_at };
}
