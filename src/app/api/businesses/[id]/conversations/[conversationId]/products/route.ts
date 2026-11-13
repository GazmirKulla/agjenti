import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { readBusinessFields } from "@/lib/items/fields";
import { variantLabel } from "@/lib/products/variants";
import { orderablePrice } from "@/lib/products/pricing";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only product search for the manual order form: active products with an orderable price
 * (one fixed price, or variants with their own), and their variants. Prices on request are left out. */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_,()\\]/g, " ");
  let read = access.db.from("products").select("id,name,price_amount,price_mode,currency").eq("business_id", businessId)
    .eq("is_active", true).is("archived_at", null).order("name").limit(40);
  if (query) read = read.ilike("name", `%${query}%`);
  const { data, error } = await read;
  if (error) return NextResponse.json({ error: "Produktet nuk u ngarkuan." }, { status: 503 });
  const ids = (data ?? []).map((p) => p.id);
  const [variantRead, business] = await Promise.all([
    ids.length ? access.db.from("product_variants").select("id,product_id,options,price_amount").eq("business_id", businessId)
      .eq("is_active", true).in("product_id", ids).order("position") : Promise.resolve({ data: [], error: null }),
    access.db.from("businesses").select("product_fields").eq("id", businessId).maybeSingle(),
  ]);
  const fields = readBusinessFields(business.data?.product_fields);
  const variants = variantRead.error ? [] : variantRead.data ?? [];
  const products = (data ?? []).flatMap((p) => {
    const base = orderablePrice(p);
    const own = variants.filter((v) => v.product_id === p.id).flatMap((v) => {
      const price = v.price_amount ?? base;
      return price === null ? [] : [{ id: v.id, label: variantLabel(v.options, fields), price }];
    });
    // A product is orderable with its own fixed price or, when it has variants, a priced variant.
    if (base === null && !own.length) return [];
    return [{ id: p.id, name: p.name, price: base ?? Math.min(...own.map((v) => v.price)), currency: p.currency, ...(own.length ? { variants: own } : {}) }];
  }).slice(0, 20);
  return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
}
