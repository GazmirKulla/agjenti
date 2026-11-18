import { createServiceSupabase } from "@/lib/supabase/service";
import { loadItemSetup } from "@/lib/items/business";
import { itemKind } from "@/lib/items/kinds";
import { variantLabel } from "@/lib/products/variants";
import { standardFields } from "./product-query";

type Row = Record<string, unknown>;

/** One product field the owner assistant can read and filter by: from the item kind
 * (e.g. a property's area) or defined by the business itself (e.g. "Gjuha"). */
export type SchemaField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  unit?: string;
  options?: { value: string; label: string }[];
  /** The customer chooses a value; each value may be a variant with its own SKU and price. */
  variant?: boolean;
  source: string;
};
/** The business's product structure. "unavailable" means unknown, never "no fields". */
export type ProductSchema = { status: "read" | "unavailable"; itemKind: string;
  /** Columns every product has, with their types; status is derived (active, inactive, archived). */
  standardFields: { key: string; type: string }[];
  fields: SchemaField[] };
export type ProductSetup = Pick<Awaited<ReturnType<typeof loadItemSetup>>, "kind" | "fields" | "fieldsRead">;

const DESCRIPTION_LIMIT = 300;
const VALUE_LIMIT = 120;
const VARIANTS_SHOWN = 10;
/** Serialized size the product rows may take in one model input. */
export const PRODUCT_CONTEXT_BUDGET = 40_000;

export const loadProductSetup = (businessId: string) => loadItemSetup(businessId);
/** When the business's setup cannot be read: plain products, fields unknown (never "none"). */
export function unknownProductSetup(): ProductSetup {
  return { kind: itemKind("product"), fields: [], fieldsRead: false };
}

/** Kind fields for the business's kind and for every kind its products use, then the business's own fields. */
export function productSchema(setup: ProductSetup, kinds: Iterable<string> = []): ProductSchema {
  const fields: SchemaField[] = [];
  const seen = new Set<string>();
  for (const id of new Set([setup.kind.id, ...kinds])) {
    const kind = itemKind(id);
    for (const f of kind.fields) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      fields.push({ key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.options ? { options: f.options } : {}), source: `kind:${kind.id}` });
    }
  }
  for (const f of setup.fields) {
    // A customer question is asked when ordering; it holds no product value to read or edit.
    if (f.ask || f.type === "photo" || seen.has(f.key)) continue;
    seen.add(f.key);
    fields.push({ key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}),
      ...(f.options ? { options: f.options.map(o => ({ value: o, label: o })) } : {}), ...(f.variant ? { variant: true } : {}), source: "business" });
  }
  return { status: setup.fieldsRead ? "read" : "unavailable", itemKind: setup.kind.id, standardFields: standardFields.map(f => ({ key: f.key, type: f.type })), fields };
}

type VariantRow = { product_id: string; options: Record<string, string>; sku: string | null; price_amount: number | null };
export type VariantRead = { byProduct: Map<string, VariantRow[]>; status: "read" | "partial" | "unavailable" };

const VARIANT_READ_PAGES = 3;
/** Active variants of the given products only, never the whole catalog. */
export async function readVariantsFor(businessId: string, productIds: string[]): Promise<VariantRead> {
  const byProduct = new Map<string, VariantRow[]>();
  if (!productIds.length) return { byProduct, status: "read" };
  const db = createServiceSupabase();
  for (let page = 0; page < VARIANT_READ_PAGES; page++) {
    const { data, error } = await db.from("product_variants").select("product_id,options,sku,price_amount")
      .eq("business_id", businessId).eq("is_active", true).in("product_id", productIds).order("product_id").order("position").order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) return { byProduct, status: "unavailable" };
    for (const v of (data ?? []) as VariantRow[]) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);
    if ((data?.length ?? 0) < 1000) return { byProduct, status: "read" };
  }
  return { byProduct, status: "partial" };
}

const short = (value: unknown) => typeof value === "string" && value.length > VALUE_LIMIT ? `${value.slice(0, VALUE_LIMIT)}…` : value;

/** One product as the owner assistant reads it: each fact once, values keyed by field key
 * (labels are in the schema), values without a definition kept apart, variants bounded. */
export function compactProduct(row: Row, schema: ProductSchema, variants?: VariantRow[]): Row {
  const known = new Set(schema.fields.map(f => f.key));
  const values: Row = {}, unmapped: Row = {};
  const attributes = row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes) ? row.attributes as Row : {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === "") continue;
    (known.has(key) ? values : unmapped)[key] = Array.isArray(value) ? value.map(short) : short(value);
  }
  const description = typeof row.description === "string" ? row.description : null;
  const businessFields = schema.fields.filter(f => f.source === "business").map(f => ({ key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}) }));
  const compact: Row = {};
  for (const key of ["id", "name", "sku", "image_url", "price_amount", "price_mode", "price_max", "price_unit", "currency", "is_active", "archived_at", "availability",
    "item_kind", "product_type_id", "workflow_id", "updated_at"]) if (row[key] !== undefined && row[key] !== null) compact[key] = row[key];
  if (description) compact.description = description.length > DESCRIPTION_LIMIT ? `${description.slice(0, DESCRIPTION_LIMIT)}…` : description;
  if (Object.keys(values).length) compact.values = values;
  if (Object.keys(unmapped).length) compact.unmappedValues = unmapped;
  if (variants?.length) compact.variants = {
    total: variants.length,
    shown: variants.slice(0, VARIANTS_SHOWN).map(v => ({ label: variantLabel(v.options, businessFields), ...(v.sku ? { sku: v.sku } : {}), ...(v.price_amount !== null ? { price_amount: v.price_amount } : {}) })),
  };
  return compact;
}

/** Keeps rows in order until their serialized size reaches the budget. */
export function fitRows<T>(rows: T[], budget: number): { rows: T[]; cut: boolean } {
  let size = 0;
  const kept: T[] = [];
  for (const row of rows) {
    size += JSON.stringify(row).length + 1;
    if (size > budget) return { rows: kept, cut: true };
    kept.push(row);
  }
  return { rows: kept, cut: false };
}

export const CATALOG_SCAN_LIMIT = 5000;
const catalogColumns = "id,name,sku,description,image_url,price_amount,price_mode,price_max,price_unit,currency,is_active,archived_at,availability,item_kind,attributes,product_type_id,workflow_id,created_at,updated_at";
/** The whole catalog of one business, page by page, for a server-side query. complete is false past the scan limit or on a failed page. */
export async function scanCatalog(businessId: string): Promise<{ rows: Row[]; complete: boolean }> {
  const db = createServiceSupabase();
  const rows: Row[] = [];
  for (let offset = 0; offset < CATALOG_SCAN_LIMIT; offset += 1000) {
    const { data, error } = await db.from("products").select(catalogColumns).eq("business_id", businessId).order("id").range(offset, offset + 999);
    if (error) throw new Error("catalog_scan_failed");
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < 1000) return { rows, complete: true };
  }
  return { rows, complete: false };
}

/** Active variant options of the whole business, for queries on a field the customer chooses. */
export async function readVariantOptions(businessId: string): Promise<{ options: Map<string, Record<string, string>[]>; complete: boolean }> {
  const db = createServiceSupabase();
  const options = new Map<string, Record<string, string>[]>();
  for (let offset = 0; offset < VARIANT_SCAN_LIMIT; offset += 1000) {
    const { data, error } = await db.from("product_variants").select("product_id,options")
      .eq("business_id", businessId).eq("is_active", true).order("id").range(offset, offset + 999);
    if (error) throw new Error("variant_scan_failed");
    for (const v of (data ?? []) as { product_id: string; options: Record<string, string> }[]) options.set(v.product_id, [...(options.get(v.product_id) ?? []), v.options]);
    if ((data?.length ?? 0) < 1000) return { options, complete: true };
  }
  return { options, complete: false };
}
const VARIANT_SCAN_LIMIT = 20000;

/** Products ready for the model: schema covering their kinds, variants of these products only, a size budget. */
export async function describeProducts(businessId: string, setup: ProductSetup, rows: Row[], budget = PRODUCT_CONTEXT_BUDGET) {
  const schema = productSchema(setup, rows.map(r => typeof r.item_kind === "string" ? r.item_kind : "product"));
  const variants = await readVariantsFor(businessId, rows.map(r => String(r.id)));
  const fitted = fitRows(rows.map(r => compactProduct(r, schema, variants.byProduct.get(String(r.id)))), budget);
  return { schema, variants: variants.status, rows: fitted.rows, cut: fitted.cut };
}
