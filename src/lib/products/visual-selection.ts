import { createServiceSupabase } from "@/lib/supabase/service";
import { moduleEnforcementEnabled, requireRuntimeModules, capabilityModules } from "@/lib/capabilities/enforcement";
import { enforceWorkflowCapabilities, requireOwnedBindings } from "@/lib/capabilities/workflow";
import { loadVisualWorkspace } from "@/lib/workflows/visual/store";

export function visualSelection(value: unknown): { flowId: string; revision: number } | null {
  if (typeof value !== "string" || !value.startsWith("visual:")) return null;
  const match = /^visual:(\d+):([a-zA-Z0-9_-]{1,100})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error("Zgjedhja e rrjedhës nuk është e vlefshme.");
  return { revision: Number(match[1]), flowId: match[2] };
}
/** Product writes and draft binding commit together; publication is never implicit. */
export async function saveProductsWithVisualFlow(businessId: string, userId: string, selection: { flowId: string; revision: number }, mode: "create" | "update" | "import" | "bind", products: Record<string, unknown>[]) {
  if (moduleEnforcementEnabled(businessId)) {
    try {
      const workspace = await loadVisualWorkspace(businessId);
      if (workspace.revision !== selection.revision || workspace.graph.version !== 2) return { error: "Rrjedha ndryshoi. Rifresko faqen." };
      const graph = structuredClone(workspace.graph);
      const flow = graph.flows.find(f => f.id === selection.flowId);
      if (!flow) return { error: "Rrjedha nuk u gjet në këtë biznes." };
      await requireRuntimeModules(businessId, ["products", ...(flow.kind === "custom" ? capabilityModules(["order.prepare"]) : [])]);
      const ids = products.flatMap(p => typeof p.id === "string" ? [p.id] : []);
      // New IDs are assigned and ownership rechecked atomically by the existing RPC.
      await requireOwnedBindings(businessId, ids, []);
      flow.productIds = [...new Set([...(flow.productIds ?? []), ...ids])];
      await enforceWorkflowCapabilities(businessId, userId, graph, "draft");
    } catch { return { error: "Lidhja draft kërkon module aktive dhe produkte të këtij biznesi." }; }
  }
  const { data, error } = await createServiceSupabase().rpc("save_products_with_visual_flow", {
    p_business: businessId, p_user: userId, p_revision: selection.revision, p_flow: selection.flowId, p_mode: mode, p_products: products,
  });
  if (error) return { error: error.message.includes("stale_") ? "Produkti ose rrjedha ndryshoi ndërkohë. Rifresko faqen para ruajtjes." :
    error.code === "23505" ? "Një SKU është përdorur tashmë. Asnjë ndryshim nuk u ruajt." :
    ["PGRST202", "42883"].includes(error.code) ? "Lidhja kërkon migrimin e ri të databazës për produktet dhe flow-t." :
    error.message.includes("activation_requires_published") ? "Databaza përdor ende rregullin e vjetër të aktivizimit. Nevojitet migrimi i aktivizimit të katalogut; asgjë nuk u ruajt." :
    "Produktet dhe lidhja nuk u ruajtën. Kontrollo flow-n dhe rifresko faqen." };
  if (!Number.isInteger(data) || data !== products.length) return { error: "Ruajtja nuk u konfirmua. Rifresko listën para se të provosh përsëri." };
  return { success: `${data} produkt${data === 1 ? "" : "e"} u ruajtën. Lidhja me rrjedhën u ruajt si draft; publikoje te Workflow që të hyjë në fuqi.` };
}
