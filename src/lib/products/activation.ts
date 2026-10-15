import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Catalog visibility is not permission to prepare or submit an order. */
export async function requireCatalogActivation(businessId: string, products: { price_amount: number | null; currency: string; product_type_id: string | null }[]) {
  await requireRuntimeModules(businessId, ["products"]);
  if (products.some(p => p.price_amount == null || !Number.isFinite(p.price_amount) || p.price_amount < 0 || !p.product_type_id || !/^[A-Z]{3}$/.test(p.currency)))
    throw new Error("Për aktivizim në katalog duhen çmimi, monedha dhe lloji i vlefshëm. Workflow-i konfigurohet veçmas.");
  const db = createServiceSupabase();
  for (const id of new Set(products.map(p => p.product_type_id!))) {
    const { data, error } = await db.from("product_types").select("id").eq("id", id).eq("is_active", true).maybeSingle();
    if (error || !data) throw new Error("Lloji nuk është aktiv ose nuk u verifikua. Zgjidh një lloj aktiv.");
  }
}
