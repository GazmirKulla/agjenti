import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { ITEM_KINDS } from "@/lib/items/kinds";
import { storeProductFields } from "@/lib/items/fields-store";
import { askFields, readBusinessFields, type BusinessField } from "@/lib/items/fields";
import { readStockSettings, type StockSettings } from "@/lib/products/stock";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { rebuildProfileFromModules } from "@/lib/dashboard/profile/generate";
import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import type { ModuleId } from "@/lib/dashboard/modules/types";

/**
 * The business settings the owner changes from Cilësimet and the Assistant changes with a confirmed
 * operation: one writer each, so both surfaces apply the same checks (owner only, allowed values).
 */
export type BusinessSettings = {
  item: { kind: string; plural: string | null; singular: string | null };
  fields: BusinessField[];
  questions: BusinessField[];
  stock: StockSettings;
  modules: { shown: ModuleId[]; hidden: ModuleId[]; available: ModuleId[] };
};

async function ownerOnly(businessId: string, userId: string) {
  const { data } = await createServiceSupabase().from("business_users").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  return data?.role === "owner" || await isPlatformAdmin(userId);
}

/** allowedModules: the package's modules when the caller already verified them (the Assistant's access). */
export async function readBusinessSettings(businessId: string, allowedModules?: string[]): Promise<BusinessSettings> {
  const [business, profile, allowed] = await Promise.all([
    createServiceSupabase().from("businesses").select("item_kind,item_plural,item_singular,product_fields,stock_settings").eq("id", businessId).maybeSingle(),
    loadDashboardProfile(businessId),
    allowedModules ? Promise.resolve(allowedModules) : loadAllowedModules(businessId),
  ]);
  if (business.error || !business.data) throw Error("Cilësimet e biznesit nuk u lexuan.");
  const all = readBusinessFields(business.data.product_fields);
  const available = toggleableModules.filter(id => (allowed as string[]).includes(id));
  return {
    item: { kind: business.data.item_kind ?? "product", plural: business.data.item_plural ?? null, singular: business.data.item_singular ?? null },
    fields: all.filter(f => !f.ask), questions: askFields(all), stock: readStockSettings(business.data.stock_settings),
    modules: { shown: available.filter(id => profile.enabledModules.includes(id)), hidden: available.filter(id => !profile.enabledModules.includes(id)), available },
  };
}

const asRaw = (fields: BusinessField[]) => fields.map(f => ({ ...f }));
async function storedFields(businessId: string) {
  const { data, error } = await createServiceSupabase().from("businesses").select("product_fields").eq("id", businessId).maybeSingle();
  if (error) throw Error("Fushat nuk u lexuan. Rifresko faqen.");
  return readBusinessFields(data?.product_fields);
}
/** Struktura: the product data and the variant choices; the customer questions are kept as stored. */
export async function storeOwnFields(businessId: string, userId: string, raw: unknown) {
  if (!Array.isArray(raw)) return { error: "Fushat nuk janë të vlefshme." };
  const questions = askFields(await storedFields(businessId));
  const own = raw.filter(row => !(row && typeof row === "object" && (row as { ask?: unknown }).ask === true));
  return storeProductFields(businessId, userId, [...own, ...asRaw(questions)]);
}
/** The questions the agent asks a customer who orders; the product fields are kept as stored. */
export async function storeQuestions(businessId: string, userId: string, raw: unknown) {
  if (!Array.isArray(raw)) return { error: "Pyetjet nuk janë të vlefshme." };
  const fields = (await storedFields(businessId)).filter(f => !f.ask);
  // Every submitted row is a question: it is asked, never a variant.
  const questions = raw.map(row => ({ ...(row && typeof row === "object" ? row : {}), ask: true, variant: false }));
  return storeProductFields(businessId, userId, [...asRaw(fields), ...questions]);
}

const itemName = (value: unknown) => {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length >= 2 && text.length <= 30 ? text : null;
};
/** What the business lists (its kind) and what it calls one and many of them. */
export async function storeItemSetup(businessId: string, userId: string, input: { kind: unknown; plural?: unknown; singular?: unknown }) {
  if (!(await ownerOnly(businessId, userId))) return { error: "Vetëm pronari mund ta ndryshojë këtë." };
  const kind = String(input.kind ?? "");
  if (!ITEM_KINDS[kind]) return { error: "Zgjidh një lloj nga lista." };
  const { error } = await createServiceSupabase().from("businesses").update({
    item_kind: kind, item_plural: itemName(input.plural), item_singular: itemName(input.singular), updated_at: new Date().toISOString(),
  }).eq("id", businessId);
  return error ? { error: "Nuk u ruajt. Provo përsëri." } : { success: "U ruajt. Menuja dhe faqet përdorin emrin e ri." };
}

/** Which optional sections the panel shows. The core modules always stay; only modules the package allows can be shown. */
export async function storeModules(businessId: string, userId: string, selected: unknown) {
  if (!Array.isArray(selected) || selected.some(id => typeof id !== "string")) return { error: "Seksionet nuk janë të vlefshme." };
  const [profile, permitted] = await Promise.all([loadDashboardProfile(businessId), loadAllowedModules(businessId)]);
  const allowed = new Set(permitted);
  const chosen = toggleableModules.filter(id => (selected as string[]).includes(id));
  if ((selected as string[]).some(id => !toggleableModules.includes(id as ModuleId) || !allowed.has(id as ModuleId)))
    return { error: "Qasja te një seksion nuk u verifikua. Rifresko faqen." };
  const enabled = new Set<ModuleId>([...profile.enabledModules.filter(id => moduleRegistry[id].core), ...chosen]);
  const preferences = { ...rebuildProfileFromModules([...enabled], profile.signals), enabledModules: [...enabled], hiddenModules: toggleableModules.filter(id => !chosen.includes(id)) };
  const { error } = await createServiceSupabase().rpc("save_business_modules", { p_business: businessId, p_user: userId, p_profile: preferences });
  return error ? { error: "Pamja nuk u ruajt. Vetëm pronari ose administratori mund ta ndryshojë; kontrollo edhe lejet aktuale." }
    : { success: "Seksionet e panelit u përditësuan. Aftësitë e asistentit nuk ndryshuan." };
}

/** What the Assistant reads about the settings: the stored values and which channels and catalog are connected. Never a credential. */
export async function settingsContext(businessId: string, allowedModules?: string[]) {
  const db = createServiceSupabase();
  const [settings, website, instagram, whatsapp] = await Promise.all([
    readBusinessSettings(businessId, allowedModules),
    db.from("integrations").select("catalog_url,status").eq("business_id", businessId).eq("kind", "http").maybeSingle(),
    db.from("instagram_connections").select("status").eq("business_id", businessId).maybeSingle(),
    db.from("whatsapp_connections").select("status").eq("business_id", businessId).maybeSingle(),
  ]);
  return { ...settings, integrations: {
    website: website.error ? "unverified" : website.data?.catalog_url ? { connected: true, host: new URL(website.data.catalog_url).hostname, status: website.data.status ?? null } : { connected: false },
    instagram: instagram.error ? "unverified" : instagram.data?.status ?? "not_connected",
    whatsapp: whatsapp.error ? "unverified" : whatsapp.data?.status ?? "not_connected",
  } };
}
