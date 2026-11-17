/** How a product's price is given: one number, "from" a number, a range, or on request
 * (staff quote). price_unit says what the price is for (m³, copë, m…). */
export const priceModes = ["fixed", "from", "range", "request"] as const;
export type PriceMode = typeof priceModes[number];
export const priceModeLabels: Record<PriceMode, string> = {
  fixed: "Çmim i caktuar", from: "Duke filluar nga", range: "Nga–deri", request: "Sipas kërkesës",
};
export type ProductPrice = {
  price_amount: number | null;
  currency: string | null;
  price_mode?: string | null;
  price_max?: number | null;
  price_unit?: string | null;
};
export const MAX_PRICE = 9999999999.99;

export function priceMode(value: unknown): PriceMode {
  return priceModes.includes(value as PriceMode) ? value as PriceMode : "fixed";
}

const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Ready to be shown in the catalog: a price, or a price given on request. */
export function priceReady(p: ProductPrice) {
  const mode = priceMode(p.price_mode);
  return mode === "request" || (isAmount(p.price_amount) && (mode !== "range" || isAmount(p.price_max)));
}

/** The product's own price can be put in an order only when it is one fixed number. */
export function orderablePrice(p: ProductPrice): number | null {
  return priceMode(p.price_mode) === "fixed" && isAmount(p.price_amount) ? p.price_amount : null;
}

/**
 * The price as the customer reads it in a reply: "500 ALL", "nga 500 ALL", "nga 500 deri 800 ALL", with
 * " për m²" when the price is for a unit. Null when there is no number to show (on request, or unset).
 */
export function customerPriceText(p: ProductPrice): string | null {
  const mode = priceMode(p.price_mode);
  const currency = p.currency?.trim();
  if (mode === "request" || !isAmount(p.price_amount) || !currency) return null;
  const unit = p.price_unit?.trim() ? ` për ${p.price_unit.trim()}` : "";
  if (mode === "range" && isAmount(p.price_max) && p.price_max !== p.price_amount) return `nga ${p.price_amount} deri ${p.price_max} ${currency}${unit}`;
  return `${mode === "from" ? "nga " : ""}${p.price_amount} ${currency}${unit}`;
}
