/** Turns one product of the website catalog (contract v1 or v2) into what a linked product stores. */

export type LinkedOptionValue = { id: string; name: string };
export type LinkedOption = { key: string; label: string; required: boolean; affectsPrice: boolean; values: LinkedOptionValue[] };
export type LinkedAddon = { id: string; name: string; price: number; appliesToVariants?: string[] };
export type LinkedFieldType = "text" | "number" | "boolean" | "date" | "choice" | "photo" | "file";
export type LinkedField = {
  key: string; label: string; type: LinkedFieldType; appliesTo: "item" | "order"; required: boolean;
  min?: number; max?: number; maxLength?: number; values?: LinkedOptionValue[];
};
/** Stored on products.external_spec; the database checks a selection against it. */
export type LinkedSpec = { version: 1 | 2; options: LinkedOption[]; addons: LinkedAddon[]; fields: LinkedField[] };
export type LinkedVariant = { external_id: string; options: Record<string, string>; sku: string | null; price_amount: number | null; is_active: boolean };
export type LinkedProduct = {
  priceMode: "fixed" | "from" | "range" | "request";
  price: number | null; priceMax: number | null; priceUnit: string | null; currency: string;
  variants: LinkedVariant[]; spec: LinkedSpec;
  /** The website's main photo of the product (https), or null. */
  imageUrl: string | null;
};

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const FIELD_TYPES = new Set<LinkedFieldType>(["text", "number", "boolean", "date", "choice", "photo", "file"]);
const MODES = new Set(["fixed", "from", "range", "request"]);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);
const amount = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9_999_999_999.99 ? Math.round(v * 100) / 100 : null);
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : undefined);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x)) : [];

export class LinkedCatalogError extends Error {}

/** `image` (or `imageUrl`) as a plain https link; anything else is ignored. */
function imageOf(raw: Record<string, unknown>): string | null {
  const value = typeof raw.image === "string" ? raw.image : typeof raw.imageUrl === "string" ? raw.imageUrl : null;
  const url = value?.trim();
  if (!url || url.length > 2000) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function values(raw: unknown): LinkedOptionValue[] {
  const seen = new Set<string>();
  return list(raw).flatMap((v) => {
    const id = str(v.id, 200), name = str(v.name, 60);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

/** Contract v1: formats are the variants, colors a choice. */
function fromV1(raw: Record<string, unknown>, currency: string): LinkedProduct {
  const formats = values(raw.formats).map((v) => ({ ...v, price: amount(list(raw.formats).find((f) => str(f.id, 200) === v.id)?.price) }));
  const colors = values(raw.colors);
  const options: LinkedOption[] = [];
  if (formats.length) options.push({ key: "format", label: "Formati", required: true, affectsPrice: true, values: formats.map(({ id, name }) => ({ id, name })) });
  if (colors.length) options.push({ key: "color", label: "Ngjyra", required: false, affectsPrice: false, values: colors });
  const prices = formats.map((f) => f.price).filter((p): p is number => p !== null);
  const own = amount(raw.price);
  const price = own ?? (prices.length ? Math.min(...prices) : null);
  return {
    priceMode: price === null ? "request" : prices.length > 1 && new Set(prices).size > 1 ? "from" : "fixed",
    price, priceMax: null, priceUnit: null, currency,
    variants: dedupe(formats.map((f) => ({ external_id: f.id, options: { format: f.name }, sku: null, price_amount: f.price, is_active: true }))),
    spec: { version: 1, options, addons: [], fields: [] },
    imageUrl: imageOf(raw),
  };
}

/** Two variants with the same choices cannot both be stored; the first one stays. */
function dedupe(variants: LinkedVariant[]): LinkedVariant[] {
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = JSON.stringify(Object.entries(v.options).sort());
    if (seen.has(key) || seen.has(`id:${v.external_id}`)) return false;
    seen.add(key);
    seen.add(`id:${v.external_id}`);
    return true;
  }).slice(0, 100);
}

export function normalizeLinkedProduct(raw: Record<string, unknown>, catalogCurrency?: unknown): LinkedProduct {
  const currency = str(raw.currency, 3) ?? str(catalogCurrency, 3) ?? "ALL";
  if (!/^[A-Z]{3}$/.test(currency)) throw new LinkedCatalogError("Monedha e produktit nuk është e vlefshme.");
  if (!Array.isArray(raw.variants) && !Array.isArray(raw.options)) return fromV1(raw, currency);

  const options: LinkedOption[] = list(raw.options).map((o) => {
    const key = str(o.key, 40), label = str(o.label, 80) ?? key;
    if (!key || !KEY.test(key)) throw new LinkedCatalogError("Webi përdor një çelës opsioni që nuk pranohet (vetëm a-z, 0-9, _).");
    return { key, label: label!, required: o.required !== false, affectsPrice: o.affectsPrice === true, values: values(o.values) };
  }).filter((o) => o.values.length > 0);
  if (new Set(options.map((o) => o.key)).size !== options.length) throw new LinkedCatalogError("Webi deklaron të njëjtin opsion dy herë.");
  const byKey = new Map(options.map((o) => [o.key, o]));

  const variants = dedupe(list(raw.variants).flatMap((v) => {
    const id = str(v.id, 200);
    const chosen = v.options && typeof v.options === "object" ? Object.entries(v.options as Record<string, unknown>) : [];
    if (!id || !chosen.length || chosen.length > 4) return [];
    const named: Record<string, string> = {};
    for (const [key, valueId] of chosen) {
      const name = byKey.get(key)?.values.find((x) => x.id === valueId)?.name;
      if (!name) return [];
      named[key] = name;
    }
    return [{ external_id: id, options: named, sku: str(v.sku, 80), price_amount: amount(v.price), is_active: v.active !== false }];
  }));

  const addons: LinkedAddon[] = list(raw.addons).flatMap((a) => {
    const id = str(a.id, 200), name = str(a.name, 80), price = amount(a.price);
    if (!id || !name || price === null) return [];
    const applies = Array.isArray(a.appliesToVariants) ? a.appliesToVariants.filter((x): x is string => typeof x === "string") : undefined;
    return [{ id, name, price, ...(applies ? { appliesToVariants: applies } : {}) }];
  }).slice(0, 40);

  const fields: LinkedField[] = list(raw.fields).flatMap((f) => {
    const key = str(f.key, 40), label = str(f.label, 80) ?? key, type = f.type as LinkedFieldType;
    if (!key || !KEY.test(key) || !FIELD_TYPES.has(type) || byKey.has(key)) return [];
    const field: LinkedField = { key, label: label!, type, appliesTo: f.appliesTo === "order" ? "order" : "item", required: f.required === true };
    const min = count(f.min), max = count(f.max), maxLength = count(f.maxLength);
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
    if (maxLength !== undefined) field.maxLength = maxLength;
    if (type === "choice") field.values = values(f.values);
    return [field];
  }).slice(0, 24);

  const prices = variants.filter((v) => v.is_active).map((v) => v.price_amount).filter((p): p is number => p !== null);
  let priceMode = MODES.has(raw.priceMode as string) ? (raw.priceMode as LinkedProduct["priceMode"]) : null;
  let price = amount(raw.price) ?? (prices.length ? Math.min(...prices) : null);
  let priceMax = amount(raw.priceMax);
  if (!priceMode) priceMode = price === null ? "request" : new Set(prices).size > 1 ? "from" : "fixed";
  if (priceMode !== "request" && price === null) priceMode = "request";
  if (priceMode === "request") price = null;
  if (priceMode !== "range" || priceMax === null || (price !== null && priceMax < price)) {
    if (priceMode === "range") priceMode = "from";
    priceMax = null;
  }
  return {
    priceMode, price, priceMax, priceUnit: str(raw.priceUnit, 20), currency, variants,
    spec: { version: 2, options, addons, fields },
    imageUrl: imageOf(raw),
  };
}
