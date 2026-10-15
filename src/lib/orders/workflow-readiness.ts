import { createServiceSupabase } from "@/lib/supabase/service";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import { validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
import { readOrderSnapshot } from "@/lib/workflows/order-snapshot";
import { isDeepStrictEqual } from "node:util";

/** Configuration only. This never grants a draft permission to execute. */
export function hasOrderPath(graph: VisualGraph, productId?: string): boolean {
  if (!validateVisualGraph(graph).graph) return false;
  if (graph.version === 1) return graph.nodes.some(n => n.kind === "product");
  return graph.flows.some(flow => (!productId || !flow.productIds?.length || flow.productIds.includes(productId)) && !flow.serviceIds?.length && (
    flow.kind === "order" || flow.kind === "custom" && !!flow.productIds?.length ||
    flow.nodeIds.some(id => graph.nodes.some(n => n.id === id && n.kind === "product"))));
}

export async function hasOrderConfiguration(businessId: string, candidate?: VisualGraph): Promise<boolean> {
  if (candidate) return hasOrderPath(candidate);
  const published = await loadVisualVersion(businessId);
  if (published && hasOrderPath(published.graph)) return true;
  const { count, error } = await createServiceSupabase().from("products")
    .select("id,workflows!inner(id,workflow_steps!inner(key))", { count: "exact", head: true })
    .eq("business_id", businessId).eq("is_active", true).eq("workflows.business_id", businessId);
  if (error) throw new Error("Nuk u verifikua workflow-i i porosisë.");
  return !!count;
}

/** Persisted conversation state only, never client parameters. Historical versions
 * stay pinned, but tenant/version/path must be independently verified. */
export async function hasSubmissionWorkflow(businessId: string, state: ConversationStatePayload): Promise<boolean> {
  if (!state.product_id) return false;
  if (state.visual) {
    if (state.visual.versionId.startsWith("preview:") || state.visual.versionId.startsWith("simulation:")) return false;
    const version = await loadVisualVersion(businessId, state.visual.versionId);
    if (!version || version.businessId !== businessId || !hasOrderPath(version.graph, state.product_id)) return false;
    const binding = state.visual.binding;
    if (binding && (binding.entity.kind !== "product" || binding.entity.id !== state.product_id || version.graph.version !== 2 ||
        !version.graph.flows.some(f => f.id === binding.flowId && f.productIds?.includes(state.product_id!)))) return false;
    return version.graph.nodes.some(n => n.id === state.visual!.nodeId) && state.visual.visited.some(id => version.graph.nodes.some(n => n.id === id && n.kind === "product") ||
      version.graph.version === 2 && version.graph.flows.some(f => f.nodeIds.includes(id) && (f.kind === "order" || f.kind === "custom" && f.productIds?.includes(state.product_id!))));
  }
  const linear = state.context?.execution.linear ?? state.linearSnapshot;
  if (linear?.versionId && !linear.versionId.startsWith("linear-preview:")) {
    const { data, error } = await createServiceSupabase().from("linear_workflow_versions").select("id,steps")
      .eq("business_id", businessId).eq("workflow_id", linear.id).eq("id", linear.versionId).maybeSingle();
    if (error) throw new Error("Nuk u verifikua versioni i porosisë.");
    if (data && Array.isArray(data.steps) && data.steps.length && isDeepStrictEqual(data.steps, linear.steps)) return true;
  }
  const sealed = readOrderSnapshot(state.orderWorkflowSnapshot, businessId, state.product_id);
  return !!sealed?.steps.length;
}
