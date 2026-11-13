import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { itemKind } from "./kinds";
import { parseBusinessFields, type BusinessField } from "./fields";

/** Saves the business's product fields. Only the owner or a platform administrator may change them. */
export async function storeProductFields(businessId: string, userId: string, raw: unknown): Promise<{ fields: BusinessField[] } | { error: string }> {
  const db = createServiceSupabase();
  const { data: member } = await db.from("business_users").select("role")
    .eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (member?.role !== "owner" && !(await isPlatformAdmin(userId))) return { error: "Vetëm pronari mund t’i ndryshojë fushat e produkteve." };
  const { data: business } = await db.from("businesses").select("item_kind").eq("id", businessId).maybeSingle();
  const parsed = parseBusinessFields(raw, itemKind(business?.item_kind).fields.map(f => f.key));
  if ("error" in parsed) return parsed;
  const { error } = await db.from("businesses").update({ product_fields: parsed.fields, updated_at: new Date().toISOString() }).eq("id", businessId);
  if (error) return { error: "Fushat nuk u ruajtën. Provo përsëri." };
  return parsed;
}
