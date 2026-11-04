import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { OperationError } from "@/lib/actions/operations/error";
import { catalogFilter, productCatalogColumns, type ProductRow } from "./catalog";
import { loadVisualBindings } from "@/lib/workflows/visual/bindings";
import { loadVisualFlowChoices } from "@/lib/workflows/visual/choices";
import type { Preview } from "@/lib/business-assistant/model";

export type RemovalSelection = { scope: "all" | "listed" | "ids"; ids?: string[]; query?: string; status?: string };
export type RemovalRow = { id: string; name: string; updated_at: string; operation: "delete" | "archive" };
export function removalError(code?: string): OperationError {
  return new OperationError(({
    product_has_history: "Një produkt tani ka histori të lidhur. Asgjë nga grupi nuk u ndryshua. Përgatite propozimin përsëri për të shqyrtuar arkivimin.",
    stale_product: "Lista e shqyrtuar ndryshoi. Asgjë nga grupi nuk u ndryshua. Përgatite propozimin përsëri.",
    unauthorized: "Nuk ke më qasje në këtë biznes.",
    external_catalog: "Ky katalog menaxhohet nga burimi i jashtëm.",
    invalid_batch_targets: "Zgjidh 1–100 produkte ekzistuese nga ky biznes. Lista nuk u ndryshua.",
  } as Record<string,string>)[code ?? ""] ?? "Veprimi i grupit nuk u konfirmua. Kontrollo gjendjen përpara riprovimit.");
}
export async function prepareProductRemoval(businessId: string, userId: string, input: Record<string, unknown>) {
  if (!["all", "listed", "ids"].includes(String(input.scope)) ||
      input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200) ||
      input.status !== undefined && !["all", "active", "draft", "unlinked", "imports"].includes(String(input.status)) ||
      input.scope !== "listed" && (input.query !== undefined || input.status !== undefined) ||
      input.scope !== "ids" && input.ids !== undefined) throw new OperationError("Zgjedhja e produkteve nuk është e vlefshme.");
  let ids: string[];
  const db = createServiceSupabase();
  if (input.scope === "ids") {
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 || input.ids.some(id => !uuid(id))) throw removalError("invalid_batch_targets");
    ids = [...new Set(input.ids as string[])];
  } else {
    // Resolve from the catalog, never from the model's bounded context or counts.
    // Count catches PostgREST row limits too; incomplete reads cannot become 'all'.
    const result = await db.from("products").select(productCatalogColumns, { count: "exact" }).eq("business_id", businessId).order("id").range(0, 9999);
    if (result.error || result.count === null || result.data?.length !== result.count) throw new OperationError("Lista e plotë nuk u verifikua. Ngushto përzgjedhjen; nuk u përgatit fshirje e pjesshme.");
    let products = result.data as ProductRow[];
    if (input.scope === "listed" && ["draft", "unlinked"].includes(String(input.status))) {
      const [bindings, choices] = await Promise.all([loadVisualBindings(businessId), loadVisualFlowChoices(businessId)]);
      products = products.map(product => {
        const binding = bindings.enabled && bindings.versionId ? bindings.products.find(p => p.id === product.id) : undefined;
        return { ...product, business_workflow: choices.workflow ?? null,
          visual_workflow: binding && bindings.versionId ? { versionId: bindings.versionId, flowId: binding.flowId, name: binding.flowLabel } : null };
      });
    }
    ids = catalogFilter(products, input.scope === "listed" ? String(input.query ?? "") : "", input.scope === "listed" ? String(input.status ?? "all") : "all", "", "name").map(p => p.id);
    if (!ids.length) throw new OperationError("Nuk ka produkte në këtë përzgjedhje. Asgjë nuk u ndryshua.");
    if (ids.length > 100) throw new OperationError(`Përzgjedhja ka ${ids.length} produkte. Një grup mbështet deri në 100; ngushto filtrin ose zgjidh produktet. Nuk u përgatit fshirje e pjesshme.`);
  }
  const result = await db.rpc("prepare_product_removal", { p_business: businessId, p_user: userId, p_ids: ids });
  if (result.error || !Array.isArray(result.data)) throw removalError(result.error?.message);
  const rows = result.data as RemovalRow[];
  if (rows.length !== ids.length || new Set(rows.map(r => r.id)).size !== ids.length || rows.some(r => !ids.includes(r.id) || typeof r.name !== "string" || !Number.isFinite(Date.parse(r.updated_at)) || !["delete","archive"].includes(r.operation))) throw removalError();
  const deleted = rows.filter(r => r.operation === "delete").length;
  const archived = rows.length - deleted;
  const preview: Preview = { title: `Hiq ${rows.length} produkte`, subject: `${deleted} për fshirje · ${archived} për arkivim`,
    fields: rows.map(row => ({ label: row.name, before: "—", after: row.operation === "delete" ? "Fshi përfundimisht" : "Arkivo — ruhet historia e lidhur" })),
    notice: "Konfirmimi vlen vetëm për produktet e listuara. Fshirja është përfundimtare; arkivimi ruan historikun. Nëse një produkt ndryshon ose nuk mund të fshihet, i gjithë grupi ndalet pa ndryshime." };
  return { rows, preview };
}
export async function executeProductRemoval(businessId: string, userId: string, rows: RemovalRow[]) {
  const result = await createServiceSupabase().rpc("execute_product_removal", { p_business: businessId, p_user: userId, p_rows: rows });
  if (result.error || !result.data || result.data.deleted !== rows.filter(r => r.operation === "delete").length || result.data.archived !== rows.filter(r => r.operation === "archive").length) throw removalError(result.error?.message);
  return { message: `U fshinë ${result.data.deleted} produkte dhe u arkivuan ${result.data.archived}.`, path: "products" };
}
