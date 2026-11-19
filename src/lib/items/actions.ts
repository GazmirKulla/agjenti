"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { askFields } from "./fields";
import { storeItemSetup, storeOwnFields, storeQuestions } from "@/lib/settings/store";
import { storeStockSettings } from "@/lib/products/stock-store";

/** Owner or platform administrator: what the business lists and what it calls it. */
export async function saveItemSetup(slug: string, formData: FormData) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const saved = await storeItemSetup(access.business.id, user.id, { kind: formData.get("item_kind"), plural: formData.get("item_plural"), singular: formData.get("item_singular") });
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return saved;
}

/** Owner or platform administrator: the business's own product fields (e.g. Gjatësia, Druri). */
/** Struktura: the product's data and the customer's variant choices. The customer questions are kept as stored. */
export async function saveProductFields(slug: string, fieldsJson: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  let raw: unknown;
  try { raw = JSON.parse(fieldsJson); } catch { return { error: "Fushat nuk janë të vlefshme." }; }
  let saved: Awaited<ReturnType<typeof storeOwnFields>>;
  try { saved = await storeOwnFields(access.business.id, user.id, raw); } catch (e) { return { error: (e as Error).message }; }
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
  let saved: Awaited<ReturnType<typeof storeQuestions>>;
  try { saved = await storeQuestions(access.business.id, user.id, raw); } catch (e) { return { error: (e as Error).message }; }
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "Pyetjet u ruajtën. Te çdo produkt zgjedh cilat bën Agjenti.", questions: askFields(saved.fields) };
}
