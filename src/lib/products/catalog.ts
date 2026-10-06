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
  product_type_id: string | null;
  workflow_id: string | null;
  is_active: boolean;
  created_at?: string;
};
export type Option = { id: string; name: string; description?: string | null };
export function isMapped(p: ProductRow) {
  return Boolean(p.product_type_id && p.workflow_id);
}
export function catalogStatus(p: ProductRow) {
  return !isMapped(p) ? "unlinked" : p.is_active ? "active" : "draft";
}
export const statusNames = {
  unlinked: "I palidhur",
  active: "Aktiv",
  draft: "Draft",
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
        (filter === "all" ||
          (filter === "imports"
            ? p.source === "linked" || Boolean(p.external_id)
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
