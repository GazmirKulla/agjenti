import type { SupabaseClient } from "@supabase/supabase-js";
import { readBusinessFields } from "@/lib/items/fields";
import { variantLabel } from "@/lib/products/variants";
import { orderablePrice } from "@/lib/products/pricing";
import type { LinkedAddon, LinkedField, LinkedOption, LinkedSpec } from "@/lib/integrations/linked-catalog";

export type OrderVariant = { id: string; label: string; price: number; externalId: string | null };
/** What the business website declares beyond the variant: choices, extras and the item's fields. */
export type OrderDeclared = { options: LinkedOption[]; addons: LinkedAddon[]; fields: LinkedField[] };
/** A product as the manual order form shows it (web panel and native app). */
export type OrderProduct = {
  id: string; name: string; price: number; currency: string | null; unit: string | null; image: string | null;
  variants?: OrderVariant[]; declared?: OrderDeclared; sendsToWebsite: boolean;
};

/**
 * Active products with an orderable price (one fixed price, or variants with their own), their variants
 * and the unit the price is for (m³…). Prices on request are left out. `query` searches by name;
 * `ids` reads those products. Null when the catalog could not be read.
 */
export async function loadOrderProducts(db: SupabaseClient, businessId: string, filter: { query?: string; ids?: string[] }): Promise<OrderProduct[] | null> {
  let read = db.from("products").select("id,name,price_amount,price_mode,price_unit,currency,source,external_spec,image_url").eq("business_id", businessId)
    .eq("is_active", true).is("archived_at", null).order("name").limit(40);
  if (filter.query) read = read.ilike("name", `%${filter.query}%`);
  if (filter.ids) read = read.in("id", filter.ids);
  const { data, error } = await read;
  if (error) return null;
  const ids = (data ?? []).map((p) => p.id);
  const [variantRead, business, integration] = await Promise.all([
    ids.length ? db.from("product_variants").select("id,product_id,options,price_amount,external_id").eq("business_id", businessId)
      .eq("is_active", true).in("product_id", ids).order("position") : Promise.resolve({ data: [], error: null }),
    db.from("businesses").select("product_fields").eq("id", businessId).maybeSingle(),
    db.from("integrations").select("orders_url").eq("business_id", businessId).eq("kind", "http").maybeSingle(),
  ]);
  const sendsOrders = Boolean(integration.data?.orders_url?.trim());
  const fields = readBusinessFields(business.data?.product_fields);
  const variants = variantRead.error ? [] : variantRead.data ?? [];
  return (data ?? []).flatMap((p): OrderProduct[] => {
    const base = orderablePrice(p);
    // A linked product names its choices the way the website does ("Formati: A4").
    const spec = p.source === "linked" && p.external_spec ? (p.external_spec as LinkedSpec) : null;
    const labels = spec ? spec.options.map((o) => ({ key: o.key, label: o.label, type: "text" as const })) : fields;
    const own = variants.filter((v) => v.product_id === p.id).flatMap((v) => {
      const price = v.price_amount ?? base;
      return price === null ? [] : [{ id: v.id, label: variantLabel(v.options, labels), price, externalId: v.external_id ?? null, keys: Object.keys(v.options ?? {}) }];
    });
    // A product is orderable with its own fixed price or, when it has variants, a priced variant.
    if (base === null && !own.length) return [];
    const variantKeys = new Set(own.flatMap((v) => v.keys));
    const declared = spec ? {
      options: spec.options.filter((o) => !variantKeys.has(o.key)),
      addons: spec.addons,
      fields: spec.fields.filter((f) => f.appliesTo === "item"),
    } : null;
    return [{ id: p.id, name: p.name, price: base ?? Math.min(...own.map((v) => v.price)), currency: p.currency, unit: p.price_unit ?? null,
      image: typeof p.image_url === "string" && p.image_url.startsWith("https://") ? p.image_url : null,
      ...(own.length ? { variants: own.map((v) => ({ id: v.id, label: v.label, price: v.price, externalId: v.externalId })) } : {}),
      ...(declared ? { declared } : {}), sendsToWebsite: sendsOrders && p.source === "linked" }];
  });
}
