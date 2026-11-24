import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { createServiceSupabase } from "@/lib/supabase/service";
import { priceReady, type ProductPrice } from "./pricing";

/** Catalog visibility is not permission to prepare or submit an order. */
export async function requireCatalogActivation(businessId: string, products: (ProductPrice & { currency: string; product_type_id?: string | null })[]) {
  await requireRuntimeModules(businessId, ["products"]);
  // A price on request needs no amount; every other product shows its price. The product type is
  // only a template of order steps: it does not decide whether a product is in the catalog.
  if (products.some(p => !priceReady(p) || !/^[A-Z]{3}$/.test(p.currency)))
    throw new Error("Për aktivizim në katalog duhen çmimi (ose “Sipas kërkesës”) dhe monedha. Workflow-i konfigurohet veçmas.");
  const db = createServiceSupabase();
  for (const id of new Set(products.flatMap(p => p.product_type_id ? [p.product_type_id] : []))) {
    const { data, error } = await db.from("product_types").select("id").eq("id", id).eq("is_active", true).maybeSingle();
    if (error || !data) throw new Error("Shablloni i porosisë nuk është aktiv ose nuk u verifikua. Zgjidh një shabllon aktiv.");
  }
}
