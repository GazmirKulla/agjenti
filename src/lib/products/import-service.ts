import { createHash, randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { Access } from "@/lib/business-assistant/service";
import { loadItemSetup } from "@/lib/items/business";
import { storeProductFields } from "@/lib/items/fields-store";
import { autoMapAttributes, buildImportPreview, importFields, readImportCsv, type CatalogProduct, type ImportOptions, type ImportPreview, type ImportSource } from "./import-model";
import { linkPlanFields, planNewFields, planOptions, validatePlan, type ColumnUse, type ImportPlan } from "./import-plan";
import type { BusinessField } from "@/lib/items/fields";

export function assertImportAccess(access: Access) {
  if (!access.modules.includes("products") || access.catalogSource !== "internal") throw Error("Importi lejohet vetëm në katalogun e brendshëm me modulin Produktet aktiv.");
}
export function sealImportSource(access: Access, raw: string, name: string): ImportSource {
  assertImportAccess(access);
  const csv = readImportCsv(raw);
  return { name, raw, count: csv.cells.length, headers: csv.headers, mapping: csv.mapping, token: encryptSecret(JSON.stringify({ purpose: "product-import-source", userId: access.userId, businessId: access.businessId, expires: Date.now() + 3600000, raw })) };
}

/** Plans are remembered per set of column titles: the same titles are read the same way next time. */
export function planSignature(headers: string[]) {
  return createHash("sha256").update(JSON.stringify(headers.map(h => h.normalize("NFC").trim().toLowerCase()))).digest("hex").slice(0, 32);
}
type StoredPlan = { savedAt: string; missingPrice: ImportPlan["missingPrice"]; columns: { index: number; use: ColumnUse; fieldKey?: string; blank?: string[] }[] };
const MAX_SAVED_PLANS = 20;
async function readStoredPlans(businessId: string): Promise<Record<string, StoredPlan>> {
  const { data, error } = await createServiceSupabase().from("businesses").select("product_import_plans").eq("id", businessId).maybeSingle();
  const plans = !error && data?.product_import_plans && typeof data.product_import_plans === "object" ? data.product_import_plans as Record<string, StoredPlan> : {};
  return plans;
}
/** The approved plan for these titles, checked again against today's file and fields; undefined when there is none. */
export async function loadSavedPlan(access: Access, headers: string[], cells: string[][], fields: BusinessField[]): Promise<ImportPlan | undefined> {
  const stored = (await readStoredPlans(access.businessId))[planSignature(headers)];
  if (!stored || !Array.isArray(stored.columns)) return undefined;
  // Only links to fields that still exist are kept; a removed field's column is not read.
  const keys = new Set(fields.map(f => f.key));
  const columns = stored.columns.filter(c => !c.fieldKey || keys.has(c.fieldKey))
    .map(c => ({ ...c, use: (c.use === "field" || c.use === "choice") && !c.fieldKey ? "ignore" as const : c.use }));
  const plan = validatePlan({ columns, missingPrice: stored.missingPrice }, headers, cells, fields);
  return plan.columns.length ? plan : undefined;
}
async function rememberPlan(businessId: string, headers: string[], plan: ImportPlan) {
  const plans = await readStoredPlans(businessId);
  plans[planSignature(headers)] = { savedAt: new Date().toISOString(), missingPrice: plan.missingPrice,
    columns: plan.columns.map(c => ({ index: c.index, use: c.use, ...(c.fieldKey ? { fieldKey: c.fieldKey } : {}), ...(c.blank?.length ? { blank: c.blank } : {}) })) };
  const kept = Object.entries(plans).sort(([, a], [, b]) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, MAX_SAVED_PLANS);
  const { error } = await createServiceSupabase().from("businesses").update({ product_import_plans: Object.fromEntries(kept) }).eq("id", businessId);
  if (error) throw Error("Plani i leximit nuk u ruajt. Provo përsëri.");
}

/** A newly uploaded file: when its titles have an approved plan, it is read by that plan. */
export async function openImportSource(access: Access, raw: string, name: string): Promise<ImportSource> {
  const source = sealImportSource(access, raw, name);
  try {
    const csv = readImportCsv(raw), { fields } = await loadItemSetup(access.businessId);
    const plan = await loadSavedPlan(access, csv.headers, csv.cells, fields);
    if (!plan) return source;
    const options = planOptions(plan, { fields: [...importFields] });
    return { ...source, plan, options, mapping: options.mapping };
  } catch { return source; } // without the remembered plan the file is still read by its titles
}

/** The owner approves the reading plan: the fields it proposes are added, its columns are linked,
 * the plan is remembered for these titles and the rows are compared with the catalog. Nothing
 * in the catalog changes until the rows themselves are approved. */
export async function acceptImportPlan(access: Access, source: string, rawPlan: unknown, base: Pick<ImportOptions, "fields" | "lines" | "productTypeId" | "workflowId">) {
  const { raw } = openImportToken(source, access, "product-import-source");
  const csv = readImportCsv(raw);
  let { fields } = await loadItemSetup(access.businessId);
  let plan = validatePlan(rawPlan, csv.headers, csv.cells, fields);
  const added = planNewFields(plan);
  if (added.length) {
    const saved = await storeProductFields(access.businessId, access.userId, [...fields, ...added]);
    if ("error" in saved) throw Error(saved.error);
    fields = saved.fields;
  }
  plan = linkPlanFields(plan, fields);
  await rememberPlan(access.businessId, csv.headers, plan);
  const options = planOptions(plan, { ...base, fields: base.fields?.length ? base.fields : [...importFields] });
  return { plan, options, fields, preview: await prepareImport(access, source, options, fields) };
}

export function openImportToken(token: string, access: Access, purpose: string) {
  assertImportAccess(access);
  try {
    if (typeof token !== "string" || token.length > 2000000) throw Error();
    const value = JSON.parse(decryptSecret(token));
    if (value.purpose !== purpose || value.userId !== access.userId || value.businessId !== access.businessId || !Number.isFinite(value.expires) || value.expires < Date.now()) throw Error();
    return value;
  } catch { throw Error("Importi ka skaduar ose nuk është i vlefshëm. Vlerësoje përsëri."); }
}
export async function loadImportCatalog(access: Access): Promise<CatalogProduct[]> {
  assertImportAccess(access);
  const db = createServiceSupabase(), rows: CatalogProduct[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("products").select("id,updated_at,name,sku,price_amount,price_mode,price_max,price_unit,currency,description,image_url,is_active,product_type_id,workflow_id,attributes").eq("business_id", access.businessId).order("id").range(offset, offset + 999);
    if (error) throw Error("Katalogu nuk u verifikua. Provo përsëri.");
    rows.push(...(data ?? []) as CatalogProduct[]);
    if ((data?.length ?? 0) < 1000) return rows;
    if (rows.length >= 100000) throw Error("Katalogu është shumë i madh për këtë import. Kontakto mbështetjen.");
  }
}
export async function prepareImport(access: Access, source: string, options: ImportOptions, knownFields?: BusinessField[]): Promise<ImportPreview> {
  const { raw } = openImportToken(source, access, "product-import-source");
  const db = createServiceSupabase();
  for (const [table, id] of [["product_types", options.productTypeId], ["workflows", options.workflowId]]) {
    if (!id) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw Error("Zgjedhje konfigurimi e pavlefshme.");
    let query = db.from(table!).select("id").eq("id", id);
    query = table === "workflows" ? query.eq("business_id", access.businessId) : query.eq("is_active", true);
    const result = await query.maybeSingle();
    if (result.error || !result.data) throw Error("Konfigurimi nuk është i vlefshëm për këtë biznes.");
  }
  // Fields just added by an accepted plan are passed in: the cached setup of this request predates them.
  const [catalog, setup] = await Promise.all([loadImportCatalog(access), knownFields ? { fields: knownFields } : loadItemSetup(access.businessId)]);
  // Callers that never chose columns for the business's own fields get the ones named like them.
  const attributes = options.attributes ?? autoMapAttributes(readImportCsv(raw).headers, setup.fields, Object.values(options.mapping ?? {}).filter((n): n is number => typeof n === "number"));
  const rows = buildImportPreview(raw, { ...options, attributes }, catalog, setup.fields);
  const changes = rows.filter(r => r.status === "create" || r.status === "update");
  const token = changes.length && !rows.some(r => r.status === "conflict") ? encryptSecret(JSON.stringify({ purpose: "product-import-confirm", userId: access.userId, businessId: access.businessId, expires: Date.now() + 1800000, id: randomUUID(), rows: changes })) : undefined;
  if (token && token.length > 1800000) throw Error("Grupi ka shumë tekst për një miratim. Zgjidh më pak rreshta dhe vlerëso përsëri.");
  return { rows, token, fieldLabels: Object.fromEntries(setup.fields.map(f => [f.key, f.label])) };
}
export async function commitImport(access: Access, token: string) {
  const plan = openImportToken(token, access, "product-import-confirm");
  const { data, error } = await createServiceSupabase().rpc("apply_product_csv_import", { p_business: access.businessId, p_user: access.userId, p_id: plan.id, p_rows: plan.rows });
  if (error) {
    if (/invalid_variant/.test(error.message)) throw Error("Një variant ka vlera të pavlefshme (deri në 4 fusha, 60 shkronja secila). Asgjë nuk u ruajt.");
    if (/stale|duplicate|23505/.test(`${error.message} ${error.code}`)) throw Error("Katalogu ndryshoi ose SKU-ja është zënë. Vlerëso CSV-në përsëri; grupi nuk u ruajt.");
    if (error.code === "PGRST202") throw Error("Importi pret përditësimin e databazës. Asnjë produkt nuk u ndryshua.");
    throw Error("Grupi nuk u ruajt. Provo përsëri; ndryshimet ruhen të gjitha bashkë.");
  }
  return { success: `U ruajtën ${data} ndryshime. Produktet e reja janë draft; produktet ekzistuese ruajnë statusin.` };
}
