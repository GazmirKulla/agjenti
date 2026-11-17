import type { ProductSchema } from "./product-fields";

/** A product query the owner assistant's model proposes and this module checks and runs.
 * The model only says which field, which comparison and which value; the server decides
 * what exists, compares values deterministically and counts. Nothing here interprets
 * the owner's words: that is the model's job, and its output is validated as data. */

type Row = Record<string, unknown>;
type Scalar = string | number | boolean;
export const queryOps = ["eq", "neq", "in", "contains", "missing", "present", "gt", "gte", "lt", "lte"] as const;
export type QueryOp = typeof queryOps[number];
export type QueryFilter = { field: string; op: QueryOp; value?: Scalar | Scalar[] };
export type ProductQuery = { filters: QueryFilter[]; groupBy?: string; sort?: { field: string; dir: "asc" | "desc" }; offset: number; limit: number };
type FieldType = "text" | "number" | "select" | "boolean" | "date";
export type QueryField = { key: string; type: FieldType; variant?: boolean };

/** Columns every product has. status is derived: archived, active or inactive. */
const standardFields: QueryField[] = [
  { key: "name", type: "text" }, { key: "sku", type: "text" }, { key: "description", type: "text" },
  { key: "price_amount", type: "number" }, { key: "price_max", type: "number" }, { key: "price_mode", type: "text" }, { key: "price_unit", type: "text" },
  { key: "currency", type: "text" }, { key: "status", type: "text" }, { key: "availability", type: "text" }, { key: "item_kind", type: "text" },
  { key: "product_type_id", type: "text" }, { key: "workflow_id", type: "text" }, { key: "created_at", type: "date" }, { key: "updated_at", type: "date" },
];
export const MAX_FILTERS = 10;
export const MAX_RESULT_ROWS = 60;
const MAX_GROUPS = 50;

/** Standard columns, the schema's fields, and keys found on products without a definition (a removed or renamed field). */
export function queryFields(schema: ProductSchema, unmappedKeys: Iterable<string> = []): Map<string, QueryField> {
  const fields = new Map<string, QueryField>(standardFields.map(f => [f.key, f]));
  for (const f of schema.fields) if (!fields.has(f.key)) fields.set(f.key, { key: f.key, type: f.type, ...(f.variant ? { variant: true } : {}) });
  for (const key of unmappedKeys) if (!fields.has(key)) fields.set(key, { key, type: "text" });
  return fields;
}

const isScalar = (v: unknown): v is Scalar => typeof v === "string" ? v.length <= 200 : typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean";
const parseJson = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return Symbol.for("invalid"); }
};

/** Checks the model's query against the business's fields. Errors go back to the model so it can correct them. */
export function parseProductQuery(raw: { filters?: unknown; group_by?: unknown; sort?: unknown; offset?: unknown; query?: unknown }, fields: Map<string, QueryField>):
  { query: ProductQuery } | { error: string } {
  const filters = parseJson(raw.filters) ?? [];
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) return { error: `filters must be a JSON array of at most ${MAX_FILTERS} {field, op, value}.` };
  const parsed: QueryFilter[] = [];
  for (const item of filters) {
    if (!item || typeof item !== "object") return { error: "Each filter must be an object {field, op, value}." };
    const { field, op, value } = item as Row;
    const def = typeof field === "string" ? fields.get(field) : undefined;
    if (!def) return { error: `Unknown field ${JSON.stringify(field)}. Use a key from data.productFields.fields or a standard field.` };
    if (!queryOps.includes(op as QueryOp)) return { error: `Unknown op ${JSON.stringify(op)}. Allowed: ${queryOps.join(", ")}.` };
    if (op === "missing" || op === "present") { parsed.push({ field: def.key, op }); continue; }
    if (op === "in") {
      if (!Array.isArray(value) || !value.length || value.length > 40 || !value.every(isScalar)) return { error: `Filter ${def.key} in needs an array of 1–40 values.` };
      parsed.push({ field: def.key, op, value }); continue;
    }
    if (!isScalar(value)) return { error: `Filter ${def.key} ${op} needs one value.` };
    if (["gt", "gte", "lt", "lte"].includes(op as string) && def.type !== "date" && numberOf(value) === null)
      return { error: `Filter ${def.key} ${op} needs a number.` };
    if (["gt", "gte", "lt", "lte"].includes(op as string) && def.type === "date" && !Number.isFinite(Date.parse(String(value))))
      return { error: `Filter ${def.key} ${op} needs an ISO date.` };
    parsed.push({ field: def.key, op: op as QueryOp, value });
  }
  const text = typeof raw.query === "string" ? raw.query.trim() : "";
  if (text && text !== "*") {
    if (text.length > 120) return { error: "query must be at most 120 characters." };
    parsed.push({ field: "name_or_sku", op: "contains", value: text });
  }
  const groupBy = typeof raw.group_by === "string" && raw.group_by.trim() ? raw.group_by.trim() : undefined;
  if (groupBy && !fields.has(groupBy)) return { error: `Unknown group_by field ${JSON.stringify(groupBy)}.` };
  const sortRaw = parseJson(raw.sort);
  let sort: ProductQuery["sort"];
  if (sortRaw !== undefined) {
    const s = sortRaw as Row;
    if (!s || typeof s !== "object" || typeof s.field !== "string" || !fields.has(s.field) || !["asc", "desc"].includes(String(s.dir)))
      return { error: "sort must be JSON {field, dir: asc|desc} with a known field." };
    sort = { field: s.field, dir: s.dir as "asc" | "desc" };
  }
  const offset = Number(raw.offset ?? 0);
  return { query: { filters: parsed, ...(groupBy ? { groupBy } : {}), ...(sort ? { sort } : {}), offset: Number.isInteger(offset) && offset >= 0 ? offset : 0, limit: MAX_RESULT_ROWS } };
}

/** Same characters regardless of accents, case and spacing: a format rule, not a reading of meaning. */
const fold = (value: unknown) => String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.replace(/\s/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

export type VariantOptions = Map<string, Record<string, string>[]>;
/** Every value a product has for a field: a column, a stored attribute (one value or a list of choices) and its variants' options. */
export function valuesOf(row: Row, field: QueryField | { key: "name_or_sku"; type: "text" }, variants?: VariantOptions): Scalar[] {
  const keep = (v: unknown): v is Scalar => v !== null && v !== undefined && v !== "" && isScalar(v);
  if (field.key === "name_or_sku") return [row.name, row.sku].filter(keep);
  if (field.key === "status") return [row.archived_at ? "archived" : row.is_active ? "active" : "inactive"];
  if (standardFields.some(f => f.key === field.key)) return [row[field.key]].filter(keep);
  const attributes = row.attributes && typeof row.attributes === "object" ? row.attributes as Row : {};
  const stored = attributes[field.key];
  const values = (Array.isArray(stored) ? stored : [stored]).filter(keep);
  if ("variant" in field && field.variant) for (const options of variants?.get(String(row.id)) ?? []) if (keep(options[field.key])) values.push(options[field.key]);
  return [...new Map(values.map(v => [typeof v === "string" ? fold(v) : v, v])).values()];
}

function equal(stored: Scalar, wanted: Scalar) {
  if (typeof stored === "boolean" || typeof wanted === "boolean") return stored === wanted;
  const a = numberOf(stored), b = numberOf(wanted);
  if (a !== null && b !== null) return a === b;
  return fold(stored) === fold(wanted);
}

/** "match" or "no", or "unknown" when a value exists but cannot be compared (e.g. "3-5 vjec" against a number). */
function test(values: Scalar[], filter: QueryFilter, type: FieldType): "match" | "no" | "unknown" {
  const { op, value } = filter;
  if (op === "missing") return values.length ? "no" : "match";
  if (op === "present") return values.length ? "match" : "no";
  if (!values.length) return "no";
  if (op === "eq") return values.some(v => equal(v, value as Scalar)) ? "match" : "no";
  if (op === "neq") return values.some(v => equal(v, value as Scalar)) ? "no" : "match";
  if (op === "in") return values.some(v => (value as Scalar[]).some(w => equal(v, w))) ? "match" : "no";
  if (op === "contains") return values.some(v => fold(v).includes(fold(value))) ? "match" : "no";
  const target = type === "date" ? Date.parse(String(value)) : numberOf(value)!;
  const comparable = values.map(v => type === "date" ? Date.parse(String(v)) : numberOf(v)).filter((n): n is number => n !== null && Number.isFinite(n));
  if (!comparable.length) return "unknown";
  const ok = (n: number) => op === "gt" ? n > target : op === "gte" ? n >= target : op === "lt" ? n < target : n <= target;
  return comparable.some(ok) ? "match" : "no";
}

export type QueryOutcome = {
  scanned: number;
  matched: Row[];
  /** Products left out because a value exists but cannot be compared; the model must say so, not count them as no. */
  uncomparable: { field: string; count: number }[];
  groups?: { field: string; values: { value: Scalar; count: number }[]; missing: number; more: number };
};

export function runProductQuery(rows: Row[], query: ProductQuery, fields: Map<string, QueryField>, variants?: VariantOptions): QueryOutcome {
  const unknown = new Map<string, number>();
  const nameOrSku = { key: "name_or_sku" as const, type: "text" as const };
  const matched = rows.filter(row => {
    const undecided: string[] = [];
    for (const filter of query.filters) {
      const field = filter.field === "name_or_sku" ? nameOrSku : fields.get(filter.field)!;
      const outcome = test(valuesOf(row, field, variants), filter, field.type);
      if (outcome === "no") return false;
      if (outcome === "unknown") undecided.push(filter.field);
    }
    // Counted only when no other filter already excludes the product.
    for (const field of undecided) unknown.set(field, (unknown.get(field) ?? 0) + 1);
    return !undecided.length;
  });
  if (query.sort) {
    const field = fields.get(query.sort.field)!, dir = query.sort.dir === "asc" ? 1 : -1;
    const key = (row: Row) => {
      const v = valuesOf(row, field, variants)[0];
      if (v === undefined) return null;
      // A value that does not fit the field's type sorts with the missing ones.
      if (field.type === "date") { const t = Date.parse(String(v)); return Number.isFinite(t) ? t : null; }
      if (field.type === "number") return numberOf(v);
      return fold(v);
    };
    matched.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  let groups: QueryOutcome["groups"];
  if (query.groupBy) {
    const field = fields.get(query.groupBy)!;
    const counts = new Map<string, { value: Scalar; count: number }>();
    let missing = 0;
    for (const row of matched) {
      const values = valuesOf(row, field, variants);
      if (!values.length) missing++;
      for (const v of values) {
        const id = typeof v === "string" ? fold(v) : String(v);
        counts.set(id, { value: counts.get(id)?.value ?? v, count: (counts.get(id)?.count ?? 0) + 1 });
      }
    }
    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    groups = { field: field.key, values: sorted.slice(0, MAX_GROUPS), missing, more: Math.max(0, sorted.length - MAX_GROUPS) };
  }
  return { scanned: rows.length, matched, uncomparable: [...unknown].map(([field, count]) => ({ field, count })), ...(groups ? { groups } : {}) };
}
