/** Which product fields the form shows at once. With a few fields the form
 * shows them all; with many, it shows the kind's own fields, the ones this
 * product already has, and the ones the business fills on most products. The
 * rest wait behind "+ Shto të dhënë". Hidden fields stay in the form, so
 * saving never drops a value. */

/** Up to this many of the business's own fields, all are shown. */
export const SHOW_ALL_UP_TO = 6;
/** A field filled on at least this share of the products counts as in use. */
const IN_USE_SHARE = 1 / 3;
/** With fewer products than this there is no usage to learn from yet. */
const MIN_PRODUCTS = 3;

export type FieldUsage = { counts: Record<string, number>; total: number };

const filled = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && value !== false && !(Array.isArray(value) && value.length === 0);

/** How many products have a value for each field. */
export function fieldUsage(products: { attributes?: Record<string, unknown> | null }[]): FieldUsage {
  const counts: Record<string, number> = {};
  for (const product of products)
    for (const [key, value] of Object.entries(product.attributes ?? {})) if (filled(value)) counts[key] = (counts[key] ?? 0) + 1;
  return { counts, total: products.length };
}

/** The keys of the business's own fields the form shows at once. */
export function shownFieldKeys(own: { key: string }[], values: Record<string, unknown> | undefined, usage: FieldUsage | undefined): Set<string> {
  if (own.length <= SHOW_ALL_UP_TO) return new Set(own.map(f => f.key));
  const shown = new Set(own.filter(f => filled(values?.[f.key])).map(f => f.key));
  if (!usage || usage.total < MIN_PRODUCTS) {
    // Nothing to learn from yet: the first fields, in the owner's order.
    for (const f of own.slice(0, SHOW_ALL_UP_TO)) shown.add(f.key);
    return shown;
  }
  for (const f of own) if ((usage.counts[f.key] ?? 0) / usage.total >= IN_USE_SHARE) shown.add(f.key);
  return shown;
}
