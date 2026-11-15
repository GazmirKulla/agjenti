/** The items of an order as the Inbox, the app and the agent show them: name and quantity, in order. */
export type OrderItemSummary = { name: string; quantity: number };

/** Select fragment for `orders`: its items with the product name. */
export const ORDER_ITEMS_SELECT = "order_items(quantity,position,products(name))";

type Row = { quantity: number | string | null; position: number | null; products: { name: string | null } | { name: string | null }[] | null };

export function orderItemSummary(rows: unknown): OrderItemSummary[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Row[])
    .slice()
    .sort((a, b) => (a.position ?? -1) - (b.position ?? -1))
    .map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      return { name: product?.name?.trim() || "Produkt", quantity: Number(row.quantity) || 1 };
    })
    .slice(0, 20);
}

/** "2 × Puzzle A4, 1 × Kornizë" */
export function orderItemsText(items: OrderItemSummary[]): string {
  return items.map((item) => `${item.quantity} × ${item.name}`).join(", ");
}
