import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only product search for the manual order form (active products with a price). */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_,()\\]/g, " ");
  let read = access.db.from("products").select("id,name,price_amount,currency").eq("business_id", businessId)
    .eq("is_active", true).is("archived_at", null).not("price_amount", "is", null).order("name").limit(20);
  if (query) read = read.ilike("name", `%${query}%`);
  const { data, error } = await read;
  if (error) return NextResponse.json({ error: "Produktet nuk u ngarkuan." }, { status: 503 });
  return NextResponse.json(
    { products: (data ?? []).map((p) => ({ id: p.id, name: p.name, price: p.price_amount, currency: p.currency })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
