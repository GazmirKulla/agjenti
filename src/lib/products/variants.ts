import type { BusinessField } from "@/lib/items/fields";

/** One choice of a product, e.g. { gjatesia: "120 cm" }, with its own SKU and optional price. */
export type ProductVariant = {
  id?: string;
  options: Record<string, string>;
  sku: string | null;
  price_amount: number | null;
  is_active: boolean;
};

export const MAX_VARIANTS = 100;
export const MAX_CHOICES = 40;
/** The values a customer chooses from, kept on the product: attributes.gjatesia = ["2","3","4"]. */
export type ChoiceLists = Record<string, string[]>;
/** Process field id for a variant choice; the order RPC reads options["variant_<key>"]. */
export const variantFieldId = (key: string) => `variant_${key}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanValue = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";

/** "2; 3; 4" or "5x5 | 6x6 cm" → the separate values. A trailing unit the field already
 * names ("10x10 cm" for a field in cm) is dropped so every value is written the same way. */
export function splitChoices(text: string, unit?: string): string[] {
  const suffix = unit?.trim().toLowerCase();
  const values = text.split(/[;|]/).map(part => {
    let value = cleanValue(part);
    if (suffix && value.toLowerCase().endsWith(` ${suffix}`)) value = value.slice(0, -suffix.length).trim();
    return value;
  }).filter(Boolean);
  return [...new Set(values)];
}

/** Every list stored on the product. The order check in the database requires a value from
 * each of them, so all are read, also one whose field the owner has since renamed. */
export function choiceLists(attributes: unknown): ChoiceLists {
  const values = attributes && typeof attributes === "object" ? attributes as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(values).flatMap(([key, list]) =>
    Array.isArray(list) && list.length ? [[key, list.filter((v): v is string => typeof v === "string")]] : []));
}

/** Validates the owner's variant table against the business's variant fields. */
export function parseVariants(raw: unknown, fields: BusinessField[]): { variants: ProductVariant[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Variantet nuk janë të vlefshme." };
  if (raw.length > MAX_VARIANTS) return { error: `Një produkt mund të ketë deri në ${MAX_VARIANTS} variante.` };
  const keys = fields.filter(f => f.variant).map(f => f.key);
  const seen = new Set<string>();
  const variants: ProductVariant[] = [];
  for (const [index, item] of raw.entries()) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const source = (row.options && typeof row.options === "object" ? row.options : {}) as Record<string, unknown>;
    const options = Object.fromEntries(keys.flatMap(key => { const value = cleanValue(source[key]); return value ? [[key, value]] : []; }));
    const sku = typeof row.sku === "string" && row.sku.trim() ? row.sku.trim().slice(0, 80) : null;
    const priceText = row.price_amount === null || row.price_amount === undefined ? "" : String(row.price_amount).trim().replace(",", ".");
    if (!Object.keys(options).length) {
      if (!sku && !priceText) continue; // an empty row the owner added and left
      return { error: `Varianti ${index + 1}: zgjidh të paktën një vlerë.` };
    }
    const signature = JSON.stringify(keys.map(k => options[k] ?? null));
    if (seen.has(signature)) return { error: `Varianti ${index + 1} është i njëjtë me një tjetër.` };
    seen.add(signature);
    let price: number | null = null;
    if (priceText) {
      price = Number(priceText);
      if (!Number.isFinite(price) || price < 0 || price > 9999999999.99) return { error: `Varianti ${index + 1}: çmimi duhet të jetë numër pozitiv.` };
      price = Math.round(price * 100) / 100;
    }
    variants.push({ ...(typeof row.id === "string" && uuid.test(row.id) ? { id: row.id } : {}), options, sku, price_amount: price, is_active: row.is_active !== false });
  }
  return { variants };
}

/** The values a customer can choose for each variant field: from the active variant rows,
 * or, when the product has none, from the lists kept on the product. Rows win. */
export function variantChoices(variants: ProductVariant[], fields: BusinessField[], lists: ChoiceLists = {}) {
  const active = variants.filter(v => v.is_active);
  if (!active.length) return Object.entries(lists).flatMap(([key, values]) => {
    const field = fields.find(f => f.key === key) ?? { key, label: key, type: "select" as const, variant: true };
    return values.length ? [{ field, values }] : [];
  });
  return fields.filter(f => f.variant).flatMap(field => {
    const values = [...new Set(active.flatMap(v => v.options[field.key] ? [v.options[field.key]] : []))];
    return values.length ? [{ field, values }] : [];
  });
}

/** "Gjatësia: 2, 3, 4 m; Trashësia: 3, 5 cm" — the lists the agent may tell a customer. */
export function choiceDetails(lists: ChoiceLists, fields: BusinessField[]) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  return Object.entries(lists).filter(([, values]) => values.length).map(([key, values]) => {
    const field = byKey.get(key);
    return `${field?.label ?? key}: ${values.join(", ")}${field?.unit ? ` ${field.unit}` : ""}`;
  }).join("; ");
}

/** The one active variant that matches every chosen value, or undefined. */
export function matchVariant(variants: ProductVariant[], chosen: Record<string, unknown>) {
  const matches = variants.filter(v => v.is_active && Object.entries(v.options).every(([key, value]) => chosen[variantFieldId(key)] === value));
  return matches.length === 1 ? matches[0] : undefined;
}

/** "Gjatësia 80 cm: 500 ALL; Gjatësia 120 cm: 800 ALL" — what the agent may tell a customer. */
/** "120" → "120 cm" when the field has a unit the value does not already carry. */
function withUnit(field: BusinessField | undefined, value: string) {
  return field?.unit && !value.toLowerCase().includes(field.unit.toLowerCase()) ? `${value} ${field.unit}` : value;
}
export function variantDetails(variants: ProductVariant[], fields: BusinessField[], base: { price: number | null; currency: string }) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  return variants.filter(v => v.is_active).map(v => {
    const name = Object.entries(v.options).map(([key, value]) => `${byKey.get(key)?.label ?? key} ${withUnit(byKey.get(key), value)}`).join(", ");
    const price = v.price_amount ?? base.price;
    return price === null ? name : `${name}: ${price} ${base.currency}`;
  }).join("; ");
}

export function variantLabel(options: Record<string, string>, fields: BusinessField[]) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  return Object.entries(options).map(([key, value]) => `${byKey.get(key)?.label ?? key}: ${withUnit(byKey.get(key), value)}`).join(" · ");
}
