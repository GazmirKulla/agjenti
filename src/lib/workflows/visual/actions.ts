"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { loadVisualWorkspace } from "./store";
import type { VisualWorkspace } from "./types";

export type VisualSaveResult = { workspace?: VisualWorkspace; error?: string; errors?: { nodeId?: string; message: string }[] };

async function mutate(slug: string, revision: number, raw: unknown, operation: string): Promise<VisualSaveResult> {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  if (!Number.isInteger(revision) || revision < 0) return { error: "Rifresko faqen dhe provo përsëri." };
  const graph = operation === "draft" ? normalizeVisualDraft(raw) : operation === "publish" ? validateVisualGraph(raw).graph : null;
  if (["draft", "publish"].includes(operation) && !graph) return {
    error: "Kontrollo hapat e shënuar.", errors: validateVisualGraph(raw).errors,
  };
  const { error } = await createServiceSupabase().rpc("save_visual_workflow", {
    p_business: access.business.id, p_user: user.id, p_revision: revision, p_graph: graph, p_operation: operation,
  });
  if (error) return { error: error.message.includes("stale_workflow")
    ? "Rrjedha ndryshoi në një dritare tjetër. Rifresko faqen para ruajtjes."
    : ["PGRST202", "42883", "42P01"].includes(error.code)
      ? "Apliko migrimin 20261010110000_visual_workflows.sql për të ruajtur rrjedhën."
      : "Rrjedha nuk u ruajt. Provo përsëri." };
  revalidatePath(`/b/${slug}`, "layout");
  return { workspace: await loadVisualWorkspace(access.business.id) };
}
export async function saveVisualWorkflow(slug: string, revision: number, graph: unknown) {
  return mutate(slug, revision, graph, "draft");
}
export async function publishVisualWorkflow(slug: string, revision: number, graph: unknown) {
  return mutate(slug, revision, graph, "publish");
}
export async function setVisualWorkflowEnabled(slug: string, revision: number, enabled: boolean) {
  if (typeof enabled !== "boolean") return { error: "Kërkesë e pavlefshme." };
  return mutate(slug, revision, null, enabled ? "enable" : "disable");
}
