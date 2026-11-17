import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { itemNames, itemTitles, kindInUse, profileCategory } from "./kinds";
import { readBusinessFields } from "./fields";
import { readStockSettings } from "@/lib/products/stock";

/** The business's main item kind and what it calls its items. Falls back to
 * the kind its onboarding category suggests, then to plain products. */
export const loadItemSetup = cache(async (businessId: string) => {
  const db = createServiceSupabase();
  let read = await db.from("businesses")
    .select("item_kind,item_plural,item_singular,dashboard_profile,product_fields").eq("id", businessId).maybeSingle();
  const fieldsRead = !read.error;
  // Before the product-fields migration the column is absent: keep the kind and names working.
  if (read.error) read = await db.from("businesses").select("item_kind,item_plural,item_singular,dashboard_profile").eq("id", businessId).maybeSingle() as typeof read;
  // Read on its own: before the stock migration the column is absent and the rest must still load.
  const stockRead = await db.from("businesses").select("stock_settings").eq("id", businessId).maybeSingle();
  const data = read.data as { item_kind?: string | null; item_plural?: string | null; item_singular?: string | null; dashboard_profile?: unknown; product_fields?: unknown } | null;
  const category = profileCategory(data?.dashboard_profile);
  const kind = kindInUse(data?.item_kind, category);
  return {
    kind,
    /** The onboarding category, for the suggested product fields. */
    category,
    names: itemNames(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    titles: itemTitles(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    custom: { plural: data?.item_plural ?? null, singular: data?.item_singular ?? null },
    chosen: Boolean(data?.item_kind),
    /** The business's own product fields (attributes and variant choices). */
    fields: readBusinessFields(data?.product_fields),
    /** False when the fields could not be read: an empty list then means unknown, not none. */
    fieldsRead,
    /** How the business counts stock (defaults until the owner chooses). */
    stock: readStockSettings(stockRead.error ? null : (stockRead.data as { stock_settings?: unknown } | null)?.stock_settings),
    stockRead: !stockRead.error,
  };
});
