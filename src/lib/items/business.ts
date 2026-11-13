import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { itemKind, itemNames, itemTitles, kindForCategory } from "./kinds";
import { readBusinessFields } from "./fields";

/** The business's main item kind and what it calls its items. Falls back to
 * the kind its onboarding category suggests, then to plain products. */
export const loadItemSetup = cache(async (businessId: string) => {
  const db = createServiceSupabase();
  let read = await db.from("businesses")
    .select("item_kind,item_plural,item_singular,dashboard_profile,product_fields").eq("id", businessId).maybeSingle();
  // Before the product-fields migration the column is absent: keep the kind and names working.
  if (read.error) read = await db.from("businesses").select("item_kind,item_plural,item_singular,dashboard_profile").eq("id", businessId).maybeSingle() as typeof read;
  const data = read.data as { item_kind?: string | null; item_plural?: string | null; item_singular?: string | null; dashboard_profile?: unknown; product_fields?: unknown } | null;
  const signals = (data?.dashboard_profile as { signals?: { businessType?: string } } | null)?.signals;
  const kind = itemKind(data?.item_kind ?? kindForCategory(signals?.businessType));
  return {
    kind,
    names: itemNames(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    titles: itemTitles(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    custom: { plural: data?.item_plural ?? null, singular: data?.item_singular ?? null },
    chosen: Boolean(data?.item_kind),
    /** The business's own product fields (attributes and variant choices). */
    fields: readBusinessFields(data?.product_fields),
  };
});
