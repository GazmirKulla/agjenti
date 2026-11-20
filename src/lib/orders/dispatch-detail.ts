import type { LinkedSpec } from "@/lib/integrations/linked-catalog";

/** What the website named in its refusal, in the owner's words where Agjenti knows them. */
export type RejectionDetail = { field?: string; fieldLabel?: string; line?: number };

type Item = Record<string, unknown>;
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const filled = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** True when the item sent a value for `field` (an option, a detail, a photo or a top-level value). */
export function itemHas(item: Item, field: string): boolean {
  if (filled(record(item.options)[field]) || filled(record(item.fields)[field]) || filled(item[field])) return true;
  return Array.isArray(item.files) && item.files.some((f) => record(f).key === field);
}

/** Order-level fields the website may name; they belong to no item. */
const ORDER_FIELDS = new Set(["customer", "currency", "expectedTotal", "items", "channel", "version"]);
const LABELS: Record<string, string> = {
  customer: "Të dhënat e klientit", "customer.name": "Emri", "customer.phone": "Telefoni", "customer.address": "Adresa",
  "customer.city": "Qyteti", productId: "Produkti", variantId: "Varianti", quantity: "Sasia", addons: "Shtesat", currency: "Monedha",
};

/**
 * Which item and detail the website's refusal points at. The website names the field but not the
 * item, so for a missing field it is the first item (in the order sent) that left it empty; for
 * any other refusal an item is named only when the order has one. A website that names the item
 * (contract v2, `item`) is taken at its word.
 */
export function rejectionDetail(input: {
  code?: string;
  field?: string;
  /** The item the website named (from 1); it wins over any guess. */
  item?: number;
  items: Item[];
  /** products.external_spec by the website's product id. */
  specs: Map<string, LinkedSpec | null>;
}): RejectionDetail {
  const { field, items } = input;
  if (!field) return {};
  let line: number | undefined;
  const orderLevel = ORDER_FIELDS.has(field) || field.startsWith("customer.");
  if (!orderLevel && input.item && input.item <= items.length) line = input.item;
  else if (!orderLevel) {
    if (input.code?.startsWith("missing_")) {
      const index = items.findIndex((item) => !itemHas(item, field));
      if (index >= 0) line = index + 1;
    } else if (items.length === 1) line = 1;
  }
  const item = line ? items[line - 1] : undefined;
  const spec = item && typeof item.productId === "string" ? input.specs.get(item.productId) : undefined;
  const pool = spec ? [...spec.options, ...spec.fields] : [...input.specs.values()].flatMap((s) => (s ? [...s.options, ...s.fields] : []));
  const fieldLabel = pool.find((f) => f.key === field)?.label ?? LABELS[field];
  return { field, ...(fieldLabel ? { fieldLabel } : {}), ...(line ? { line } : {}) };
}

const REFUSALS: Record<string, string> = {
  missing_field: "mungon një fushë", missing_payload: "porosia mbërriti pa të dhëna", price_changed: "çmimi ndryshoi",
  out_of_stock: "produkti ka mbaruar", invalid_field: "një fushë nuk u pranua", unmapped_product: "produkti nuk lidhet me webin",
  unmapped_variant: "varianti nuk lidhet me webin",
};
/** "Webi e refuzoi: mungon një fushë (Adresa)"; an unknown code is shown as it is, so nothing is hidden. */
export function refusalText(rejection: { code?: string; field?: string; item?: number } | null | undefined) {
  if (!rejection?.code) return null;
  const field = rejection.field ? LABELS[rejection.field] ?? rejection.field : null;
  return `Webi e refuzoi: ${REFUSALS[rejection.code] ?? rejection.code}${field ? ` (${field}${rejection.item ? `, artikulli ${rejection.item}` : ""})` : ""}`;
}
