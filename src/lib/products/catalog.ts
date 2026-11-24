import type { BusinessWorkflow } from "@/lib/workflows/visual/business-workflow";
import { priceMode, type PriceMode } from "./pricing";
export type CatalogField = "workflow_id" | "product_type_id" | "is_active";
export type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  image_url: string | null;
  source: string;
  external_id: string | null;
  price_amount: number | null;
  currency: string;
  /** fixed, from, range (price_amount–price_max) or request; price_unit: m³, copë… */
  price_mode?: PriceMode;
  price_max?: number | null;
  price_unit?: string | null;
  product_type_id: string | null;
  workflow_id: string | null;
  /** Enriched on the server from the enabled published visual graph, never a form field. */
  visual_workflow?: { versionId: string; flowId: string; name: string } | null;
  visual_draft?: { id: string; name: string; status: string } | null;
  business_workflow?: BusinessWorkflow | null;
  is_active: boolean;
  /** What kind of item this is (product, property, vehicle…) and its own fields. */
  item_kind?: string;
  attributes?: Record<string, string | number | boolean | string[]>;
  availability?: "available" | "reserved" | "sold" | "rented";
  /** The product's variants (sizes, lengths…), loaded separately. */
  variants?: import("./variants").ProductVariant[];
  /** Counted stock (see lib/products/stock): off, tracked or unique, and the product's own count. */
  stock_mode?: import("./stock").StockMode;
  /** False when the owner keeps the product for information only. Absent before the column existed. */
  agent_orders?: boolean;
  stock_quantity?: number | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
};
export const productCatalogColumns = "id,name,description,sku,image_url,source,external_id,price_amount,price_mode,price_max,price_unit,currency,product_type_id,workflow_id,is_active,item_kind,attributes,availability,archived_at,created_at,updated_at";
export type Option = { id: string; name: string; description?: string | null; businessWorkflow?: BusinessWorkflow };
export function isMapped(p: ProductRow) {
  // Linked to the steps of an order; the product type is only the template those steps may come from.
  return Boolean(p.workflow_id || p.visual_workflow || p.business_workflow?.active);
}
/** Comes from the business website's catalog (linked there), not added here. */
export function fromWebsite(p: Pick<ProductRow, "source" | "external_id">) {
  return p.source === "linked" || Boolean(p.external_id);
}
export function catalogStatus(p: ProductRow) {
  return p.archived_at ? "archived" : p.is_active ? "active" : !isMapped(p) ? "unlinked" : "draft";
}
export const statusNames = {
  archived: "I arkivuar",
  unlinked: "I palidhur",
  active: "Publik",
  draft: "Jo publik",
};
export function catalogFilter(
  products: ProductRow[],
  query: string,
  filter: string,
  type: string,
  sort: string,
) {
  const q = query.trim().toLocaleLowerCase();
  return products
    .filter(
      (p) =>
        (!q ||
          [p.name, p.sku, p.description].some((v) =>
            v?.toLocaleLowerCase().includes(q),
          )) &&
        (!type || p.product_type_id === type) &&
        ((filter === "all" && !p.archived_at) ||
          (filter === "imports"
            ? fromWebsite(p)
            : catalogStatus(p) === filter)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "price"
          ? (a.price_amount ?? Infinity) - (b.price_amount ?? Infinity)
          : (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
}
/** Albanian grouping: a no-break space between thousands and a comma before decimals ("1 290", "12,50"). */
const amountText = (amount: number) => {
  const [whole, decimal] = amount.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}${decimal === "00" ? "" : "," + decimal}`;
};
/** "70 000–80 000 Lekë / m³", "Nga 500 Lekë", "Sipas kërkesës".
 * Deterministic across Node and browsers whose ICU currency data differs. */
export function productMoney(amount: number | null, currency: string, price?: { mode?: string | null; max?: number | null; unit?: string | null }) {
  const mode = priceMode(price?.mode);
  if (mode === "request") return "Sipas kërkesës";
  if (amount == null || !Number.isFinite(amount)) return "Pa çmim";
  const name = currency === "ALL" ? "Lekë" : currency;
  const unit = price?.unit?.trim() ? ` / ${price.unit.trim()}` : "";
  const max = mode === "range" && price?.max != null && Number.isFinite(price.max) && price.max !== amount ? `–${amountText(price.max)}` : "";
  return `${mode === "from" ? "Nga " : ""}${amountText(amount)}${max} ${name}${unit}`;
}
