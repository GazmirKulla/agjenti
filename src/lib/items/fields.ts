import type { KindField } from "./kinds";

/** A product field the business names itself, e.g. "Gjatësia" or "Druri".
 * A variant field is one the customer chooses (each value can have its own
 * SKU and price); an ask field is a question the agent puts to the customer
 * when they order a product that uses it (e.g. "Teksti në bluzë"); the others
 * describe the product. */
export type BusinessField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  unit?: string;
  options?: string[];
  variant?: boolean;
  /** Asked of the customer when ordering a product that uses it; the product stores `true` under the key. */
  ask?: boolean;
};

export const MAX_BUSINESS_FIELDS = 24;
export const MAX_VARIANT_FIELDS = 4;
const types = new Set<BusinessField["type"]>(["text", "number", "select", "boolean"]);
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

/** "Gjatësia (cm)" → "gjatesia_cm": stable, accent-free keys for attributes and variants. */
export function fieldKey(label: string): string {
  const key = label.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40).replace(/_+$/, "");
  return key || "fusha";
}

/** Tolerant read of stored fields: anything malformed is dropped, never thrown. */
export function readBusinessFields(raw: unknown): BusinessField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: BusinessField[] = [];
  for (const item of raw.slice(0, MAX_BUSINESS_FIELDS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = clean(row.label, 40);
    const key = typeof row.key === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(row.key) ? row.key : "";
    if (!label || !key || seen.has(key)) continue;
    const variant = row.variant === true;
    const type = variant ? "select" : types.has(row.type as BusinessField["type"]) ? row.type as BusinessField["type"] : "text";
    const options = Array.isArray(row.options) ? [...new Set(row.options.map(o => clean(o, 60)).filter(Boolean))].slice(0, 40) : [];
    if (type === "select" && !variant && !options.length) continue;
    seen.add(key);
    const ask = !variant && row.ask === true;
    fields.push({ key, label, type, ...(clean(row.unit, 12) ? { unit: clean(row.unit, 12) } : {}),
      ...(type === "select" && options.length ? { options } : {}), ...(variant ? { variant: true } : {}), ...(ask ? { ask: true } : {}) });
  }
  return fields;
}

/** Validates what the owner submitted; keeps existing keys so stored values stay attached. */
export function parseBusinessFields(raw: unknown, reserved: string[] = []): { fields: BusinessField[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Fushat nuk janë të vlefshme." };
  if (raw.length > MAX_BUSINESS_FIELDS) return { error: `Mund të kesh deri në ${MAX_BUSINESS_FIELDS} fusha.` };
  const used = new Set(reserved);
  const fields: BusinessField[] = [];
  for (const item of raw) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = clean(row.label, 40);
    if (label.length < 2) return { error: "Çdo fushë duhet të ketë emër (të paktën 2 shkronja)." };
    let key = typeof row.key === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(row.key) ? row.key : fieldKey(label);
    if (used.has(key)) {
      const base = key.slice(0, 36);
      let n = 2; while (used.has(`${base}_${n}`)) n += 1; key = `${base}_${n}`;
    }
    used.add(key);
    const variant = row.variant === true;
    const type = variant ? "select" : types.has(row.type as BusinessField["type"]) ? row.type as BusinessField["type"] : "text";
    const options = Array.isArray(row.options) ? [...new Set(row.options.map(o => clean(o, 60)).filter(Boolean))] : [];
    if (options.length > 40) return { error: `“${label}” ka më shumë se 40 vlera.` };
    if (type === "select" && !variant && !options.length) return { error: `Shkruaj vlerat për “${label}” (p.sh. Ah, Lis, Frashër).` };
    const unit = clean(row.unit, 12);
    if (variant && row.ask === true) return { error: `“${label}” është ose zgjedhje e klientit ose pyetje për klientin, jo të dyja.` };
    const ask = row.ask === true;
    fields.push({ key, label, type, ...(unit ? { unit } : {}), ...(type === "select" && options.length ? { options } : {}), ...(variant ? { variant: true } : {}), ...(ask ? { ask: true } : {}) });
  }
  if (fields.filter(f => f.variant).length > MAX_VARIANT_FIELDS) return { error: `Mund të kesh deri në ${MAX_VARIANT_FIELDS} fusha me variante.` };
  return { fields };
}

/** The fields that describe a product, in the same shape as an item kind's own fields. */
export function attributeFields(fields: BusinessField[]): KindField[] {
  return fields.filter(f => !f.variant && !f.ask).map(f => ({ key: f.key, label: f.label, type: f.type, summary: true,
    ...(f.unit ? { unit: f.unit } : {}), ...(f.options ? { options: f.options.map(o => ({ value: o, label: o })) } : {}) }));
}

export function variantFields(fields: BusinessField[]): BusinessField[] {
  return fields.filter(f => f.variant);
}

/** The questions the agent asks a customer who orders a product, e.g. "Teksti në bluzë". */
export function askFields(fields: BusinessField[]): BusinessField[] {
  return fields.filter(f => f.ask);
}
/** The ask fields this product uses: the owner turned each one on for it. */
export function productAskFields(fields: BusinessField[], attributes: unknown): BusinessField[] {
  const values = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes as Record<string, unknown> : {};
  return askFields(fields).filter(f => values[f.key] === true);
}
