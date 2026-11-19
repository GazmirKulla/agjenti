"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { ITEM_KINDS } from "./kinds";
import { storeProductFields } from "./fields-store";
import { askFields, readBusinessFields, type BusinessField } from "./fields";
import { storeStockSettings } from "@/lib/products/stock-store";

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
/** The stored fields, read on the server: each page changes only its own part of them. */
async function storedFields(businessId: string) {
  const { data, error } = await createServiceSupabase().from("businesses").select("product_fields").eq("id", businessId).maybeSingle();
  if (error) throw Error("Fushat nuk u lexuan. Rifresko faqen.");
  return readBusinessFields(data?.product_fields);
}
const asRaw = (fields: BusinessField[]) => fields.map(f => ({ ...f }));

/** Struktura: the product's data and the customer's variant choices. The customer questions are kept as stored. */
export async function saveProductFields(slug: string, fieldsJson: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  let raw: unknown;
  try { raw = JSON.parse(fieldsJson); } catch { return { error: "Fushat nuk janë të vlefshme." }; }
  if (!Array.isArray(raw)) return { error: "Fushat nuk janë të vlefshme." };
  let questions: BusinessField[];
  try { questions = askFields(await storedFields(access.business.id)); } catch (e) { return { error: (e as Error).message }; }
  const own = raw.filter(row => !(row && typeof row === "object" && (row as { ask?: unknown }).ask === true));
  const saved = await storeProductFields(access.business.id, user.id, [...own, ...asRaw(questions)]);
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Fushat u ruajtën. I gjen te forma e produktit dhe te importi CSV.", fields: saved.fields };
}

/** Owner or platform administrator: how the business counts stock (the order rule, what customers are told, new products' mode). */
export async function saveStockSettings(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const saved = await storeStockSettings(access.business.id, user.id, { deduct: formData.get("deduct"), display: formData.get("display"),
    defaultMode: formData.get("defaultMode"), lowThreshold: formData.get("lowThreshold") ?? undefined });
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Cilësimet e stokut u ruajtën. Vlejnë për porositë dhe përgjigjet e reja." };
}

/** Çfarë bën Agjenti: the questions the agent asks a customer who orders. The product fields are kept as stored. */
export async function saveCustomerQuestions(slug: string, questionsJson: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  let raw: unknown;
  try { raw = JSON.parse(questionsJson); } catch { return { error: "Pyetjet nuk janë të vlefshme." }; }
  if (!Array.isArray(raw)) return { error: "Pyetjet nuk janë të vlefshme." };
  let fields: BusinessField[];
  try { fields = (await storedFields(access.business.id)).filter(f => !f.ask); } catch (e) { return { error: (e as Error).message }; }
  // Every submitted row is a question: it is asked, never a variant.
  const questions = raw.map(row => ({ ...(row && typeof row === "object" ? row : {}), ask: true, variant: false }));
  const saved = await storeProductFields(access.business.id, user.id, [...asRaw(fields), ...questions]);
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Pyetjet u ruajtën. Te çdo produkt zgjedh cilat bën Agjenti.", questions: askFields(saved.fields) };
}
