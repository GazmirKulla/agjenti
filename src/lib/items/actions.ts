"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { ITEM_KINDS, itemKind } from "./kinds";
import { parseBusinessFields } from "./fields";

const name = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length >= 2 && text.length <= 30 ? text : null;
};

/** Owner or platform administrator: what the business lists and what it calls it. */
export async function saveItemSetup(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const db = createServiceSupabase();
  const { data: member } = await db.from("business_users").select("role")
    .eq("business_id", access.business.id).eq("user_id", user.id).maybeSingle();
  if (member?.role !== "owner" && !(await isPlatformAdmin(user.id))) return { error: "Vetëm pronari mund ta ndryshojë këtë." };
  const kind = String(formData.get("item_kind") ?? "");
  if (!ITEM_KINDS[kind]) return { error: "Zgjidh një lloj nga lista." };
  const { error } = await db.from("businesses").update({
    item_kind: kind, item_plural: name(formData.get("item_plural")), item_singular: name(formData.get("item_singular")),
    updated_at: new Date().toISOString(),
  }).eq("id", access.business.id);
  if (error) return { error: "Nuk u ruajt. Provo përsëri." };
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "U ruajt. Menuja dhe faqet përdorin emrin e ri." };
}

/** Owner or platform administrator: the business's own product fields (e.g. Gjatësia, Druri). */
export async function saveProductFields(slug: string, fieldsJson: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const db = createServiceSupabase();
  const { data: member } = await db.from("business_users").select("role")
    .eq("business_id", access.business.id).eq("user_id", user.id).maybeSingle();
  if (member?.role !== "owner" && !(await isPlatformAdmin(user.id))) return { error: "Vetëm pronari mund ta ndryshojë këtë." };
  let raw: unknown;
  try { raw = JSON.parse(fieldsJson); } catch { return { error: "Fushat nuk janë të vlefshme." }; }
  const { data: business } = await db.from("businesses").select("item_kind").eq("id", access.business.id).maybeSingle();
  const parsed = parseBusinessFields(raw, itemKind(business?.item_kind).fields.map(f => f.key));
  if ("error" in parsed) return parsed;
  const { error } = await db.from("businesses").update({ product_fields: parsed.fields, updated_at: new Date().toISOString() }).eq("id", access.business.id);
  if (error) return { error: "Nuk u ruajt. Provo përsëri." };
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Fushat u ruajtën. I gjen te forma e produktit dhe te importi CSV.", fields: parsed.fields };
}
