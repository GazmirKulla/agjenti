import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeVisualDraft, validateVisualGraph } from "./model";

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
  const { error } = await createServiceSupabase().rpc(
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
        : ["PGRST202", "42883", "42P01"].includes(error.code)
          ? requestId
            ? "Apliko migrimet e workflow-ve vizuale dhe historikut për të ruajtur nga Agjenti."
            : "Apliko migrimin 20261010110000_visual_workflows.sql për të ruajtur rrjedhën."
          : "Rrjedha nuk u ruajt. Provo përsëri.",
    };
  return {};
}
