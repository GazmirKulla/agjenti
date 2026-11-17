import { createServiceSupabase } from "@/lib/supabase/service";

import type { StockMovement } from "./stock";
export type { StockMovement } from "./stock";

/** The latest stock changes of one product, or of one order; empty when they cannot be read. */
export async function loadStockMovements(businessId: string, filter: { productId?: string; orderId?: string }, limit = 50): Promise<StockMovement[]> {
  let read = createServiceSupabase().from("stock_movements").select("id,product_id,variant_id,order_id,delta,quantity_after,reason,created_at")
    .eq("business_id", businessId).order("created_at", { ascending: false }).limit(limit);
  if (filter.productId) read = read.eq("product_id", filter.productId);
  if (filter.orderId) read = read.eq("order_id", filter.orderId);
  const { data, error } = await read;
  return error ? [] : (data ?? []) as StockMovement[];
}

/** The stock changes of these orders, oldest first per order, with the product's name. */
export async function loadOrderStockMovements(businessId: string, orderIds: string[]): Promise<Map<string, (StockMovement & { product_name: string | null })[]>> {
  const byOrder = new Map<string, (StockMovement & { product_name: string | null })[]>();
  if (!orderIds.length) return byOrder;
  const { data, error } = await createServiceSupabase().from("stock_movements")
    .select("id,product_id,variant_id,order_id,delta,quantity_after,reason,created_at,products(name)")
    // A long id list does not fit in a request URL: read the business's latest order movements and keep these orders'.
    .eq("business_id", businessId).not("order_id", "is", null).order("created_at", { ascending: false }).limit(5000);
  if (error) return byOrder;
  const wanted = new Set(orderIds);
  for (const row of ((data ?? []) as unknown as (StockMovement & { products: { name: string } | null })[]).reverse()) {
    if (!row.order_id || !wanted.has(row.order_id)) continue;
    const { products, ...movement } = row;
    byOrder.set(row.order_id, [...(byOrder.get(row.order_id) ?? []), { ...movement, product_name: products?.name ?? null }]);
  }
  return byOrder;
}
