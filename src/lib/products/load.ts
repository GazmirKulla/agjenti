import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { productCatalogColumns, type ProductRow, type Option } from "./catalog";
export const loadProducts = cache(async (slug: string) => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [products, types, workflows] = await Promise.all([
    db
      .from("products")
      .select(productCatalogColumns)
      .eq("business_id", access.business.id)
      .order("created_at", { ascending: false }),
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
  ]);
  if (products.error || types.error || workflows.error)
    throw new Error("Nuk u ngarkua katalogu.");
  return {
    business: access.business,
    products: (products.data ?? []) as ProductRow[],
    types: (types.data ?? []) as Option[],
    workflows: (workflows.data ?? []) as Option[],
  };
});
