import { createServiceSupabase } from "@/lib/supabase/service";

export function visualSelection(value: unknown): { flowId: string; revision: number } | null {
  if (typeof value !== "string" || !value.startsWith("visual:")) return null;
  const match = /^visual:(\d+):([a-zA-Z0-9_-]{1,100})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error("Zgjedhja e rrjedhës nuk është e vlefshme.");
  return { revision: Number(match[1]), flowId: match[2] };
}
/** Product writes and draft binding commit together; publication is never implicit. */
export async function saveProductsWithVisualFlow(businessId: string, userId: string, selection: { flowId: string; revision: number }, mode: "create" | "update" | "import" | "bind", products: Record<string, unknown>[]) {
  const { data, error } = await createServiceSupabase().rpc("save_products_with_visual_flow", {
    p_business: businessId, p_user: userId, p_revision: selection.revision, p_flow: selection.flowId, p_mode: mode, p_products: products,
  });
  if (error) return { error: error.message.includes("stale_") ? "Produkti ose rrjedha ndryshoi ndërkohë. Rifresko faqen para ruajtjes." :
    error.code === "23505" ? "Një SKU është përdorur tashmë. Asnjë ndryshim nuk u ruajt." :
    ["PGRST202", "42883"].includes(error.code) ? "Lidhja kërkon migrimin e ri të databazës për produktet dhe flow-t." :
    error.message.includes("activation_requires_published") ? "Lidhja e re është draft. Ruaje produktin si draft dhe publiko rrjedhën përpara aktivizimit." :
    "Produktet dhe lidhja nuk u ruajtën. Kontrollo flow-n dhe rifresko faqen." };
  if (!Number.isInteger(data) || data !== products.length) return { error: "Ruajtja nuk u konfirmua. Rifresko listën para se të provosh përsëri." };
  return { success: `${data} produkt${data === 1 ? "" : "e"} u ruajtën. Lidhja me rrjedhën u ruajt si draft; publikoje te Workflow që të hyjë në fuqi.` };
}
