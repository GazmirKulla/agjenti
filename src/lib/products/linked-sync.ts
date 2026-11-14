import { fetchLinkedCatalogDocument } from "@/lib/integrations/zana";
import { LinkedCatalogError, normalizeLinkedProduct } from "@/lib/integrations/linked-catalog";
import { createServiceSupabase } from "@/lib/supabase/service";

const errors: Record<string, string> = {
  unauthorized: "Nuk ke qasje në këtë biznes.",
  product_unavailable: "Produkti i lidhur nuk u gjet.",
  invalid_price: "Çmimi që jep webi nuk është i vlefshëm.",
  invalid_variant: "Një variant i webit nuk ka formatin e pranuar.",
  invalid_spec: "Përshkrimi i produktit nga webi është shumë i madh ose i pavlefshëm.",
};

export type LinkedSyncResult = { synced: number; missing: string[]; failed: { name: string; error: string }[] };

/**
 * Brings linked products in line with the live website catalog: prices, variants with the
 * website's ids, and what the order needs. The website stays the only source of these values.
 */
export async function syncLinkedProducts(input: { businessId: string; userId: string; productIds?: string[] }): Promise<LinkedSyncResult> {
  const db = createServiceSupabase();
  let read = db.from("products").select("id,name,external_id").eq("business_id", input.businessId)
    .eq("source", "linked").not("external_id", "is", null);
  if (input.productIds?.length) read = read.in("id", input.productIds);
  const { data: linked, error } = await read;
  if (error) throw new Error("Produktet e lidhura nuk u lexuan.");
  const result: LinkedSyncResult = { synced: 0, missing: [], failed: [] };
  if (!linked?.length) return result;
  const catalog = await fetchLinkedCatalogDocument(input.businessId);
  const remote = new Map(catalog.products.map((p) => [p.id, p]));
  for (const product of linked) {
    const source = remote.get(product.external_id!);
    if (!source) {
      result.missing.push(product.name);
      continue;
    }
    try {
      const next = normalizeLinkedProduct(source, catalog.currency);
      const { error: syncError } = await db.rpc("sync_linked_product", {
        p_business: input.businessId, p_user: input.userId, p_product: product.id,
        p_price_mode: next.priceMode, p_price: next.price, p_price_max: next.priceMax, p_price_unit: next.priceUnit,
        p_currency: next.currency, p_variants: next.variants, p_spec: next.spec,
      });
      if (syncError) throw new Error(errors[syncError.message] ?? "Produkti nuk u përditësua nga webi.");
      result.synced += 1;
    } catch (err) {
      result.failed.push({ name: product.name, error: err instanceof LinkedCatalogError || err instanceof Error ? err.message : "Produkti nuk u përditësua." });
    }
  }
  return result;
}

export function describeSync(result: LinkedSyncResult): { success?: string; error?: string } {
  const parts = [`${result.synced} produkte u përditësuan nga webi.`];
  if (result.missing.length) parts.push(`Nuk janë më në katalogun e webit: ${result.missing.join(", ")}.`);
  if (result.failed.length) parts.push(result.failed.map((f) => `${f.name}: ${f.error}`).join(" "));
  return result.failed.length || result.missing.length ? { error: parts.join(" ") } : { success: parts[0] };
}
