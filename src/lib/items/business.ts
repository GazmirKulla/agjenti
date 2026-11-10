import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { itemKind, itemNames, itemTitles, kindForCategory } from "./kinds";

/** The business's main item kind and what it calls its items. Falls back to
 * the kind its onboarding category suggests, then to plain products. */
export const loadItemSetup = cache(async (businessId: string) => {
  const { data } = await createServiceSupabase().from("businesses")
    .select("item_kind,item_plural,item_singular,dashboard_profile").eq("id", businessId).maybeSingle();
  const signals = (data?.dashboard_profile as { signals?: { businessType?: string } } | null)?.signals;
  const kind = itemKind(data?.item_kind ?? kindForCategory(signals?.businessType));
  return {
    kind,
    names: itemNames(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    titles: itemTitles(kind.id, { plural: data?.item_plural, singular: data?.item_singular }),
    custom: { plural: data?.item_plural ?? null, singular: data?.item_singular ?? null },
    chosen: Boolean(data?.item_kind),
  };
});
