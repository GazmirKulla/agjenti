import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { loadOrderProducts } from "@/lib/products/order-products";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only product search for the manual order form: active products with an orderable price
 * (one fixed price, or variants with their own), their variants and the unit the price is for (m³…). Prices on request are left out. */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_,()\\]/g, " ");
  const products = await loadOrderProducts(access.db, businessId, { query });
  if (!products) return NextResponse.json({ error: "Produktet nuk u ngarkuan." }, { status: 503 });
  return NextResponse.json({ products: products.slice(0, 20) }, { headers: { "Cache-Control": "private, no-store" } });
}
