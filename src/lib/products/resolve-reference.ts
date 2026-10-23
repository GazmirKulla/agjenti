import { capabilityModules, requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { createServiceSupabase } from "@/lib/supabase/service";
import { resolveProductReference, type ReferenceProduct } from "./entity-bridge";

/** Read-only entry point for the shared coordinator. Both tenant ownership and
 * active status are rechecked; presentation metadata is never a catalog cache. */
export async function resolveCurrentProductReference(args: Omit<Parameters<typeof resolveProductReference>[0], "products"> & { purpose?: "information" | "order" }) {
  await requireRuntimeModules(args.businessId, capabilityModules(["product.search"]));
  const db = createServiceSupabase();
  const products: ReferenceProduct[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("products").select("id,name,sku,price_amount,currency")
      .eq("business_id", args.businessId).eq("is_active", true).order("id").range(from, from + 499);
    if (error) return { status: "clarify" as const, reason: "catalog_unverified", reply: "Nuk u verifikua katalogu. Provo përsëri; zgjedhja e mëparshme nuk u ndryshua." };
    products.push(...data ?? []);
    if (!data || data.length < 500) break;
  }
  const result = resolveProductReference({ ...args, products });
  if (result.status === "selected" && args.purpose !== "information") await requireRuntimeModules(args.businessId, capabilityModules(["order.prepare"]));
  return result;
}
