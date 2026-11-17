/**
 * Product stock, optional per business. One module for the rules every surface shares: the product
 * form, the catalog list, the agent's catalog projection and the order check all read stock through
 * these functions, so what the owner sees as "the agent will say" is what the agent receives.
 * Counting itself (orders taking and releasing stock) happens in the database (sync_order_stock).
 */
export type StockMode = "off" | "tracked" | "unique";
export type StockDeduct = "confirmed" | "accepted" | "manual";
export type StockDisplay = "availability" | "low" | "exact";
export type StockSettings = { deduct: StockDeduct; display: StockDisplay; defaultMode: StockMode; lowThreshold: number };
export type StockState = "in_stock" | "low" | "out";

export const stockModes: readonly StockMode[] = ["off", "tracked", "unique"];
export const stockDeducts: readonly StockDeduct[] = ["confirmed", "accepted", "manual"];
export const stockDisplays: readonly StockDisplay[] = ["availability", "low", "exact"];
export const defaultStockSettings: StockSettings = { deduct: "confirmed", display: "availability", defaultMode: "off", lowThreshold: 3 };
export const MAX_STOCK = 10_000_000;

export const stockModeLabels: Record<StockMode, { label: string; hint: string }> = {
  off: { label: "Nuk e ndjek stokun", hint: "Agjenti nuk flet për sasi dhe porosia nuk kufizohet." },
  tracked: { label: "Ndiq stokun", hint: "Vendos sasinë; porositë e ulin sipas cilësimit të biznesit." },
  unique: { label: "Copë unike", hint: "Ekziston vetëm një. Pasi shitet, kalon te “Shitur” dhe Agjenti nuk e ofron më." },
};
export const stockDeductLabels: Record<StockDeduct, { label: string; effect: string }> = {
  confirmed: { label: "Kur konfirmohet porosia",
    effect: "Sasia ulet sapo porosia konfirmohet. Nëse porosia refuzohet, dështon ose fshihet, rikthehet vetë." },
  accepted: { label: "Kur porosia pranohet",
    effect: "Sasia ulet kur porosia pranohet nga uebi ose ruhet në panel. Porositë në pritje nuk e prekin; një porosi e refuzuar e rikthen." },
  manual: { label: "Vetëm dorazi",
    effect: "Porositë nuk e prekin sasinë. E ndryshon vetë te produkti." },
};
export const stockDisplayLabels: Record<StockDisplay, { label: string; hint: string }> = {
  availability: { label: "Vetëm “e kemi / ka mbaruar”", hint: "Agjenti nuk e merr fare numrin." },
  low: { label: "“Pak copë” kur sasia është e ulët", hint: "Agjenti merr vetëm gjendjen, pa numër." },
  exact: { label: "Numri i saktë", hint: "Agjenti mund t'i thotë klientit sa copë ka." },
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

/** The stored settings, or the defaults for anything missing or unreadable. */
export function readStockSettings(raw: unknown): StockSettings {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const threshold = typeof value.lowThreshold === "number" && Number.isInteger(value.lowThreshold) && value.lowThreshold >= 1 && value.lowThreshold <= 1000
    ? value.lowThreshold : defaultStockSettings.lowThreshold;
  return { deduct: pick(value.deduct, stockDeducts, defaultStockSettings.deduct), display: pick(value.display, stockDisplays, defaultStockSettings.display),
    defaultMode: pick(value.defaultMode, stockModes, defaultStockSettings.defaultMode), lowThreshold: threshold };
}

/** What the owner submitted; refuses rather than guessing. */
export function parseStockSettings(input: Record<string, unknown>): { settings: StockSettings } | { error: string } {
  const threshold = Number(input.lowThreshold);
  if (!stockDeducts.includes(input.deduct as StockDeduct) || !stockDisplays.includes(input.display as StockDisplay)
    || !stockModes.includes(input.defaultMode as StockMode)) return { error: "Zgjidh një vlerë nga lista për çdo cilësim të stokut." };
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) return { error: "“Pak copë” duhet të jetë një numër i plotë nga 1 deri në 1000." };
  return { settings: { deduct: input.deduct as StockDeduct, display: input.display as StockDisplay, defaultMode: input.defaultMode as StockMode, lowThreshold: threshold } };
}

/** A count the owner typed: blank is no count, anything else must be a number from 0 up. */
export function parseStockQuantity(raw: unknown): { quantity: number | null } | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : raw === null || raw === undefined ? "" : String(raw);
  if (!text) return { quantity: null };
  const quantity = Number(text.replace(",", "."));
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_STOCK) return { error: "Sasia duhet të jetë një numër nga 0 e lart." };
  return { quantity: Math.round(quantity * 1000) / 1000 };
}

type Counted = { stock_mode?: string | null; stock_quantity?: number | null; source?: string | null };
/** Whether this product's stock is counted here (the business website owns a linked product's stock). */
export function countsStock(product: Counted) {
  return (product.stock_mode === "tracked" || product.stock_mode === "unique") && product.source !== "linked";
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The count that applies: the variant's own, else the product's; null when nothing is counted. */
export function effectiveQuantity(product: Counted, variant?: { stock_quantity?: number | null } | null): number | null {
  if (!countsStock(product)) return null;
  if (variant && finite(variant.stock_quantity)) return variant.stock_quantity;
  return finite(product.stock_quantity) ? product.stock_quantity : null;
}

export function stockState(quantity: number | null, settings: StockSettings): StockState | null {
  if (quantity === null) return null;
  if (quantity <= 0) return "out";
  return quantity <= settings.lowThreshold ? "low" : "in_stock";
}

/**
 * The stock fact the agent receives, already limited to what the business lets customers know:
 * "në gjendje", "pak copë në gjendje", "12 copë në gjendje" or "ka mbaruar". Null when not counted.
 */
export function stockFact(quantity: number | null, settings: StockSettings, unit?: string | null): string | null {
  const state = stockState(quantity, settings);
  if (!state || quantity === null) return null;
  if (state === "out") return "ka mbaruar";
  if (settings.display === "exact") return `${quantity} ${unit?.trim() || "copë"} në gjendje`;
  return state === "low" && settings.display === "low" ? "pak copë në gjendje" : "në gjendje";
}

/** The owner's preview: what the agent would tell a customer who asks. */
export function stockCustomerSentence(quantity: number | null, settings: StockSettings, unit?: string | null): string {
  const fact = stockFact(quantity, settings, unit);
  if (!fact) return "Agjenti nuk flet për sasi për këtë produkt.";
  if (fact === "ka mbaruar") return "“Për momentin ka mbaruar.” Agjenti nuk e merr porosinë.";
  if (fact === "në gjendje") return "“Po, e kemi në gjendje.”";
  if (fact === "pak copë në gjendje") return "“Po, na kanë mbetur pak copë.”";
  return `“Po, kemi ${fact}.”`;
}

/**
 * The product's own stock fact for the agent. Without variants it is the product's count. With
 * variants each choice gets its own fact next to it (see the catalog projection); the product then
 * says only whether any choice is left, and nothing when some choice is not counted at all.
 */
export function productStockFact(product: Counted & { price_unit?: string | null },
  variants: readonly { stock_quantity?: number | null; is_active?: boolean }[], settings: StockSettings): string | null {
  if (!countsStock(product)) return null;
  const active = variants.filter(v => v.is_active !== false);
  if (!active.length) return stockFact(effectiveQuantity(product), settings, product.price_unit);
  const quantities = active.map(v => effectiveQuantity(product, v));
  if (quantities.some(q => q === null)) return null;
  const counted = quantities as number[];
  if (counted.every(q => q <= 0)) return "ka mbaruar";
  return counted.some(q => q <= 0) ? "në gjendje vetëm për disa zgjedhje" : "në gjendje";
}

/** Server check before an order: enough stock for this quantity of the chosen variant (or the product). */
export function hasStockFor(product: Counted, variant: { stock_quantity?: number | null } | null | undefined, quantity: number): boolean {
  const available = effectiveQuantity(product, variant);
  return available === null || available >= quantity;
}

/**
 * The catalog list's state for a product: "out" when nothing counted is left, "low" when some choice is
 * out or a count is at the business's "pak copë" level, else "in_stock"; null when nothing is counted.
 */
export function catalogStockState(product: Counted, variants: readonly { stock_quantity?: number | null; is_active?: boolean }[], settings: StockSettings): StockState | null {
  if (!countsStock(product)) return null;
  const active = variants.filter(v => v.is_active !== false);
  const quantities = (active.length ? active.map(v => effectiveQuantity(product, v)) : [effectiveQuantity(product)]).filter((q): q is number => q !== null);
  if (!quantities.length) return null;
  if (quantities.every(q => q <= 0)) return "out";
  return quantities.some(q => q <= settings.lowThreshold) ? "low" : "in_stock";
}
export const stockStateLabels: Record<StockState, string> = { in_stock: "Në gjendje", low: "Pak copë", out: "Ka mbaruar" };
