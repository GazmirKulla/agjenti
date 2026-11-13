import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { Access } from "@/lib/business-assistant/service";
import { loadItemSetup } from "@/lib/items/business";
import { autoMapAttributes, buildImportPreview, readImportCsv, type CatalogProduct, type ImportOptions, type ImportPreview, type ImportSource } from "./import-model";

export function assertImportAccess(access: Access) {
  if (!access.modules.includes("products") || access.catalogSource !== "internal") throw Error("Importi lejohet vetëm në katalogun e brendshëm me modulin Produktet aktiv.");
}
export function sealImportSource(access: Access, raw: string, name: string): ImportSource {
  assertImportAccess(access);
  const csv = readImportCsv(raw);
  return { name, raw, count: csv.cells.length, headers: csv.headers, mapping: csv.mapping, token: encryptSecret(JSON.stringify({ purpose: "product-import-source", userId: access.userId, businessId: access.businessId, expires: Date.now() + 3600000, raw })) };
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
    const { data, error } = await db.from("products").select("id,updated_at,name,sku,price_amount,currency,description,image_url,is_active,product_type_id,workflow_id,attributes").eq("business_id", access.businessId).order("id").range(offset, offset + 999);
    if (error) throw Error("Katalogu nuk u verifikua. Provo përsëri.");
    rows.push(...(data ?? []) as CatalogProduct[]);
    if ((data?.length ?? 0) < 1000) return rows;
    if (rows.length >= 100000) throw Error("Katalogu është shumë i madh për këtë import. Kontakto mbështetjen.");
  }
}
export async function prepareImport(access: Access, source: string, options: ImportOptions): Promise<ImportPreview> {
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
  const [catalog, setup] = await Promise.all([loadImportCatalog(access), loadItemSetup(access.businessId)]);
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
