import { loadVisualFlowChoices } from "@/lib/workflows/visual/choices";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { productCatalogColumns, type ProductRow, type Option } from "./catalog";
import { loadVisualBindings } from "@/lib/workflows/visual/bindings";
import { loadItemSetup } from "@/lib/items/business";
import { fieldUsage } from "@/lib/items/field-visibility";
/** The catalog with its stock columns; before the stock migration, without them. */
async function readCatalog(businessId: string) {
  const db = createServiceSupabase();
  const read = (columns: string) => db.from("products").select(columns).eq("business_id", businessId).order("created_at", { ascending: false });
  const counted = await read(`${productCatalogColumns},stock_mode,stock_quantity`);
  return (counted.error ? await read(productCatalogColumns) : counted) as unknown as { data: ProductRow[] | null; error: unknown };
}
async function readVariants(businessId: string) {
  const db = createServiceSupabase();
  const read = (columns: string) => db.from("product_variants").select(columns).eq("business_id", businessId).order("position");
  const counted = await read("id,product_id,options,sku,price_amount,is_active,position,stock_quantity");
  return (counted.error ? await read("id,product_id,options,sku,price_amount,is_active,position") : counted) as unknown as
    { data: { id: string; product_id: string; options: unknown; sku: string | null; price_amount: number | null; is_active: boolean; stock_quantity?: number | null }[] | null; error: unknown };
}
export const loadProducts = cache(async (slug: string) => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [products, types, workflows, bindings, choices, items, variants] = await Promise.all([
    readCatalog(access.business.id),
    db
      .from("product_types")
      .select("id,name,description")
      .eq("is_active", true)
      .order("sort_order"),
    db
      .from("workflows")
      .select("id,name")
      .eq("business_id", access.business.id)
      .order("name"),
    loadVisualBindings(access.business.id),
    loadVisualFlowChoices(access.business.id),
    loadItemSetup(access.business.id),
    readVariants(access.business.id),
  ]);
  if (products.error || types.error || workflows.error)
    throw new Error("Nuk u ngarkua katalogu.");
  return {
    business: access.business,
    items,
    /** How often each field is filled across the catalog, for the product form. */
    usage: fieldUsage((products.data ?? []) as ProductRow[]),
    products: ((products.data ?? []) as ProductRow[]).map(product => {
      const binding = bindings.enabled && bindings.versionId ? bindings.products.find(item => item.id === product.id) : undefined;
      const draft = choices.flows.find(f => f.productIds.includes(product.id));
      const own = (variants.data ?? []).filter(v => v.product_id === product.id)
        .map(v => ({ id: v.id as string, options: v.options as Record<string, string>, sku: v.sku as string | null, price_amount: v.price_amount as number | null, is_active: v.is_active as boolean,
          stock_quantity: (v.stock_quantity ?? null) as number | null }));
      return { ...product, variants: own, business_workflow: choices.workflow ?? null, visual_draft: draft ? { id: draft.id, name: draft.name, status: draft.status } : null, visual_workflow: binding && bindings.versionId ? { versionId: bindings.versionId, flowId: binding.flowId, name: binding.flowLabel } : null };
    }),
    types: (types.data ?? []) as Option[],
    workflows: [...(choices.workflow ? [{ id: "", name: choices.workflow.name, businessWorkflow: choices.workflow }] : []), ...(workflows.data ?? []).map(w => ({ ...w, name: `${w.name} · Proces i posaçëm` }))] as Option[],
  };
});
