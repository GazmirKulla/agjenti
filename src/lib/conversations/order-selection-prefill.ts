import type { LinkedField } from "@/lib/integrations/linked-catalog";
import type { OrderProduct } from "@/lib/products/order-products";

/**
 * The second reading of "Krijo porosi": once the conversation names a product, the AI picks its
 * variant (size…), the website's choices (theme, colour…), extras and the item's fields from what the
 * customer said. Only values the model is sure of, that exist on the product, are kept; the owner
 * sees each one marked "Nga biseda" and can change it before saving.
 */
export type PickedValue = { value: string; source: "biseda"; evidence: string };
export type PrefillSelection = {
  variantId: PickedValue | null;
  /** Declared choice key → the chosen value id. */
  options: Record<string, PickedValue>;
  /** Declared item field key → value as text (a choice field holds the value id, a yes/no field "true"). */
  fields: Record<string, PickedValue>;
  /** Extra ids. */
  addons: PickedValue[];
};

/** The fields the AI may fill: never photos or files, never the business's own output. */
const fillable = (product: OrderProduct) =>
  (product.declared?.fields ?? []).filter((f) => f.type !== "photo" && f.type !== "file" && f.role !== "output");

/** Whether the product has anything beyond the quantity to pick. */
export function hasChoices(product: OrderProduct): boolean {
  return Boolean(product.variants?.length || product.declared?.options.length || product.declared?.addons.length || fillable(product).length);
}

/** The product's choices as the model reads them. */
export function selectionInput(product: OrderProduct) {
  return {
    product: product.name,
    variants: (product.variants ?? []).map((v) => ({ id: v.id, label: v.label })),
    options: (product.declared?.options ?? []).map((o) => ({ key: o.key, label: o.label, values: o.values })),
    addons: (product.declared?.addons ?? []).map((a) => ({ id: a.id, name: a.name })),
    fields: fillable(product).map((f) => ({
      key: f.key, label: f.label, type: f.type,
      ...(f.values ? { values: f.values } : {}), ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}),
    })),
  };
}

const sure = { type: "boolean" } as const;
const evidence = { type: "string" } as const;
const item = (properties: Record<string, unknown>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

export const selectionSchema = item({
  variant: item({ id: { type: "string" }, evidence, sure }),
  options: { type: "array", items: item({ key: { type: "string" }, value_id: { type: "string" }, evidence, sure }) },
  addons: { type: "array", items: item({ id: { type: "string" }, evidence, sure }) },
  fields: { type: "array", items: item({ key: { type: "string" }, value: { type: "string" }, evidence, sure }) },
});

type Raw = Record<string, unknown>;
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter((x): x is Raw => Boolean(x) && typeof x === "object") : []);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const picked = (value: string, raw: Raw): PickedValue => ({ value, source: "biseda", evidence: text(raw.evidence, 120) });

/** One field value, kept only when it fits the field the website declared. */
function fieldValue(field: LinkedField, raw: string): string {
  switch (field.type) {
    case "choice": return field.values?.some((v) => v.id === raw) ? raw : "";
    case "boolean": return raw === "true" ? "true" : "";
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : "";
    case "number": {
      const value = Number(raw.replace(",", "."));
      if (!raw || !Number.isFinite(value) || (field.min != null && value < field.min) || (field.max != null && value > field.max)) return "";
      return String(value);
    }
    default: return raw.slice(0, field.maxLength ?? 500);
  }
}

/** What the model returned, checked against the product: unsure or unknown values are dropped. */
export function checkSelection(product: OrderProduct, raw: unknown): PrefillSelection {
  const data = raw && typeof raw === "object" ? (raw as Raw) : {};
  const out: PrefillSelection = { variantId: null, options: {}, fields: {}, addons: [] };

  const variant = data.variant && typeof data.variant === "object" ? (data.variant as Raw) : null;
  const variantId = variant?.sure === true ? text(variant.id, 64) : "";
  const chosen = (product.variants ?? []).find((v) => v.id === variantId);
  if (variant && chosen) out.variantId = picked(chosen.id, variant);

  for (const entry of list(data.options)) {
    if (entry.sure !== true) continue;
    const option = product.declared?.options.find((o) => o.key === entry.key);
    const value = option?.values.find((v) => v.id === entry.value_id);
    if (option && value && !out.options[option.key]) out.options[option.key] = picked(value.id, entry);
  }

  // An extra for some variants only counts when one of them was picked.
  for (const entry of list(data.addons)) {
    if (entry.sure !== true) continue;
    const addon = product.declared?.addons.find((a) => a.id === entry.id);
    if (!addon || out.addons.some((a) => a.value === addon.id)) continue;
    if (addon.appliesToVariants && !(chosen?.externalId && addon.appliesToVariants.includes(chosen.externalId))) continue;
    out.addons.push(picked(addon.id, entry));
  }

  const fields = fillable(product);
  for (const entry of list(data.fields)) {
    if (entry.sure !== true) continue;
    const field = fields.find((f) => f.key === entry.key);
    const value = field ? fieldValue(field, text(entry.value, 2000)) : "";
    if (field && value && !out.fields[field.key]) out.fields[field.key] = picked(value, entry);
  }
  return out;
}

/** True when nothing was picked. */
export const emptySelection = (selection: PrefillSelection) =>
  !selection.variantId && !Object.keys(selection.options).length && !Object.keys(selection.fields).length && !selection.addons.length;
