import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { loadWorkflowReadiness } from "../readiness";
import { loadVisualVersion, loadVisualWorkspace } from "./store";
import { unconfirmedSaveMessage } from "./save-result";

export type WorkflowOperation = "draft" | "publish" | "enable" | "disable";
/** Caller supplies server-verified identities. The RPC rechecks membership and revision atomically. */
export async function writeVisualWorkflow(
  businessId: string,
  userId: string,
  revision: number,
  raw: unknown,
  operation: WorkflowOperation,
  requestId?: string,
) {
  if (!Number.isInteger(revision) || revision < 0)
    return { error: "Rifresko faqen dhe provo përsëri." };
  const graph =
    operation === "draft"
      ? normalizeVisualDraft(raw)
      : operation === "publish"
        ? validateVisualGraph(raw).graph
        : null;
  if (["draft", "publish"].includes(operation) && !graph)
    return {
      error: "Kontrollo hapat e shënuar.",
      errors: validateVisualGraph(raw).errors,
    };
  let activationGraph = graph;
  if (operation === "enable") {
    const workspace = await loadVisualWorkspace(businessId);
    activationGraph = workspace.publishedVersionId
      ? (await loadVisualVersion(businessId, workspace.publishedVersionId))?.graph ?? null
      : null;
  }
  if ((operation === "publish" || operation === "enable") && activationGraph?.version === 2) {
    const readiness = await loadWorkflowReadiness(businessId);
    if (!readiness.ready) return { error: `Ruaje si draft dhe provoje. Para aktivizimit: ${readiness.blockers.join(" ")}` };
  }
  const { data, error } = await createServiceSupabase().rpc(
    requestId ? "apply_assistant_visual_workflow" : "save_visual_workflow",
    {
      p_business: businessId,
      p_user: userId,
      p_revision: revision,
      p_graph: graph,
      p_operation: operation,
      ...(requestId ? { p_request: requestId } : {}),
    },
  );
  if (error)
    return {
      error: error.message.includes("stale_workflow")
        ? "Rrjedha ndryshoi në një dritare tjetër. Rifresko faqen para ruajtjes."
        : error.message.includes("invalid_workflow_targets")
          ? "Një produkt ose shërbim i lidhur nuk gjendet më në këtë biznes. Hiqe lidhjen e padisponueshme dhe provo përsëri."
        : ["PGRST202", "42883", "42P01"].includes(error.code)
          ? requestId
            ? "Apliko migrimet e workflow-ve vizuale dhe historikut për të ruajtur nga Agjenti."
            : "Apliko migrimin 20261010110000_visual_workflows.sql për të ruajtur rrjedhën."
          : !error.code || error.code.length !== 5
            ? unconfirmedSaveMessage
            : "Rrjedha nuk u ruajt. Provo përsëri.",
    };
  // The RPC commits atomically and returns the new revision. Keep that
  // acknowledgement even if refreshing the editor subsequently fails.
  if (!Number.isInteger(data) || data !== revision + 1) return { error: unconfirmedSaveMessage };
  return { savedRevision: data as number, savedGraph: graph ?? undefined };
}
