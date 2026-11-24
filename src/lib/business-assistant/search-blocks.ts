import { customerPriceText, priceMode } from "@/lib/products/pricing";
import { productSchema, type ProductSetup } from "./product-fields";
import { MAX_TABLE_ROWS, storableBlocks, type TableBlock, type TableColumn, type TableRow } from "./blocks";

type Row = Record<string, unknown>;
/** A product search result as `searchContext` returns it, read defensively. */
type ProductResult = {
  kind?: unknown; mode?: unknown; status?: unknown; reason?: unknown; partial?: unknown; rowsCut?: unknown; more?: unknown;
  matchedCount?: unknown; rows?: unknown; uncomparable?: unknown;
  query?: { filters?: { field?: unknown }[]; groupBy?: unknown; sort?: { field?: unknown } } | string;
  groups?: { field?: unknown; values?: { value?: unknown; count?: unknown }[]; missing?: unknown; more?: unknown };
};
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const MAX_EXTRA_COLUMNS = 2;
/** Standard columns worth their own column when the owner's query is about them. */
const extraStandard: Record<string, string> = { sku: "SKU", availability: "Disponueshmëria" };

function status(row: Row) {
  if (row.archived_at) return "Arkivuar";
  return row.is_active ? "Aktiv" : "Joaktiv";
}
function price(row: Row) {
  const text = customerPriceText({ price_amount: typeof row.price_amount === "number" ? row.price_amount : null,
    currency: typeof row.currency === "string" ? row.currency : null, price_mode: row.price_mode as string | null,
    price_max: typeof row.price_max === "number" ? row.price_max : null, price_unit: row.price_unit as string | null });
  return text ?? (priceMode(row.price_mode) === "request" ? "Sipas kërkesës" : "—");
}
const shown = (value: unknown): string => Array.isArray(value) ? value.map(shown).filter(Boolean).join(", ")
  : value === null || value === undefined || value === "" ? "" : typeof value === "boolean" ? (value ? "Po" : "Jo") : String(value);

/** The fields the owner asked about (filters, sort), shown beside name, price and status. */
function extraColumns(result: ProductResult, setup: ProductSetup, rows: Row[]): (TableColumn & { read: (row: Row) => string })[] {
  if (!record(result.query)) return [];
  const asked = [...(result.query.filters ?? []).map(f => f?.field), result.query.sort?.field].filter((key): key is string => typeof key === "string");
  const schema = productSchema(setup, rows.map(r => typeof r.item_kind === "string" ? r.item_kind : "product"));
  const columns: (TableColumn & { read: (row: Row) => string })[] = [];
  for (const key of new Set(asked)) {
    if (columns.length >= MAX_EXTRA_COLUMNS) break;
    const field = schema.fields.find(f => f.key === key);
    if (field) {
      columns.push({ key: `f_${columns.length}`, label: field.unit ? `${field.label} (${field.unit})` : field.label, numeric: field.type === "number",
        read: row => shown(record(row.values) ? row.values[key] : undefined) });
    } else if (Object.hasOwn(extraStandard, key)) {
      columns.push({ key: `f_${columns.length}`, label: extraStandard[key], read: row => shown(row[key]) });
    }
  }
  return columns;
}

function productTable(result: ProductResult, setup: ProductSetup): TableBlock | null {
  const rows = (Array.isArray(result.rows) ? result.rows : []).filter((row): row is Row => record(row) && typeof row.id === "string" && typeof row.name === "string");
  const filtered = result.mode === "filter";
  const matched = typeof result.matchedCount === "number" ? result.matchedCount : null;
  if (filtered ? result.status !== "complete" && result.status !== "partial" : rows.length < 2) return null;
  if (!rows.length && !(filtered && result.status === "complete" && matched === 0)) return null;
  const extra = extraColumns(result, setup, rows);
  const columns: TableColumn[] = [{ key: "name", label: "Emri" }, ...extra.map(({ key, label, numeric }) => ({ key, label, ...(numeric ? { numeric } : {}) })),
    { key: "price", label: "Çmimi", numeric: true }, { key: "status", label: "Statusi" }];
  const tableRows: TableRow[] = rows.slice(0, MAX_TABLE_ROWS).map(row => ({
    cells: { name: String(row.name).slice(0, 300), price: price(row), status: status(row),
      ...Object.fromEntries(extra.map(column => [column.key, column.read(row).slice(0, 300)])) },
    ref: { kind: "product", id: row.id as string },
  }));
  const uncomparable = Array.isArray(result.uncomparable) ? result.uncomparable.flatMap(u =>
    record(u) && typeof u.field === "string" && typeof u.count === "number" && u.count > 0
      ? [`${u.field} (${u.count})`] : []) : [];
  const partial = filtered ? result.status !== "complete" || result.more === true || Boolean(result.rowsCut) : result.partial === true;
  const notes = [
    filtered && result.status === "partial" ? `Kërkimi është i pjesshëm. U gjetën ${matched ?? rows.length} përputhje në pjesën e kontrolluar.` : "",
    uncomparable.length ? `Vlera të pakrahasueshme sipas fushës: ${uncomparable.join(", ")}.` : "",
  ].filter(Boolean);
  return { type: "table", version: 1, title: filtered ? "Produktet që plotësojnë kushtin" : "Produktet e gjetura", columns, rows: tableRows,
    total: filtered ? (result.status === "complete" ? matched : null) : partial ? null : rows.length, partial, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

function groupTable(result: ProductResult, setup: ProductSetup): TableBlock | null {
  const groups = result.groups;
  if (!record(groups) || typeof groups.field !== "string" || !Array.isArray(groups.values)) return null;
  const field = productSchema(setup).fields.find(f => f.key === groups.field);
  const label = field?.label ?? (groups.field === "status" ? "Statusi" : groups.field);
  const rows: TableRow[] = groups.values.slice(0, MAX_TABLE_ROWS - 1).flatMap(group => record(group) && typeof group.count === "number"
    ? [{ cells: { value: shown(group.value).slice(0, 300) || "—", count: String(group.count) } }] : []);
  if (typeof groups.missing === "number" && groups.missing > 0) rows.push({ cells: { value: "Pa vlerë", count: String(groups.missing) } });
  if (!rows.length) return null;
  const more = typeof groups.more === "number" && groups.more > 0;
  return { type: "table", version: 1, title: `Sipas: ${label}`.slice(0, 200), columns: [{ key: "value", label }, { key: "count", label: "Produkte", numeric: true }],
    rows, total: null, partial: more || result.status !== "complete", ...(more ? { note: `${groups.more} vlera të tjera nuk shfaqen.` } : {}) };
}

/** The tables the owner sees under the reply to a catalog search: built from the server's result only. */
export function searchBlocks(result: unknown, setup: ProductSetup): TableBlock[] {
  if (!record(result) || result.kind !== "product") return [];
  const product = result as ProductResult;
  return storableBlocks([groupTable(product, setup), productTable(product, setup)].filter(Boolean)) as TableBlock[];
}
