import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { readBusinessFields } from "@/lib/items/fields";
import { variantLabel } from "@/lib/products/variants";
import { orderablePrice } from "@/lib/products/pricing";
import type { LinkedSpec } from "@/lib/integrations/linked-catalog";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only product search for the manual order form: active products with an orderable price
 * (one fixed price, or variants with their own), their variants and the unit the price is for (m³…). Prices on request are left out. */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_,()\\]/g, " ");
  let read = access.db.from("products").select("id,name,price_amount,price_mode,price_unit,currency,source,external_spec").eq("business_id", businessId)
    .eq("is_active", true).is("archived_at", null).order("name").limit(40);
  if (query) read = read.ilike("name", `%${query}%`);
  const { data, error } = await read;
  if (error) return NextResponse.json({ error: "Produktet nuk u ngarkuan." }, { status: 503 });
  const ids = (data ?? []).map((p) => p.id);
  const [variantRead, business] = await Promise.all([
    ids.length ? access.db.from("product_variants").select("id,product_id,options,price_amount,external_id").eq("business_id", businessId)
      .eq("is_active", true).in("product_id", ids).order("position") : Promise.resolve({ data: [], error: null }),
    access.db.from("businesses").select("product_fields").eq("id", businessId).maybeSingle(),
  ]);
  const integration = await access.db.from("integrations").select("orders_url").eq("business_id", businessId).eq("kind", "http").maybeSingle();
  const sendsOrders = Boolean(integration.data?.orders_url?.trim());
  const fields = readBusinessFields(business.data?.product_fields);
  const variants = variantRead.error ? [] : variantRead.data ?? [];
  const products = (data ?? []).flatMap((p) => {
    const base = orderablePrice(p);
    // A linked product names its choices the way the website does ("Formati: A4").
    const spec = p.source === "linked" && p.external_spec ? (p.external_spec as LinkedSpec) : null;
    const labels = spec ? spec.options.map((o) => ({ key: o.key, label: o.label, type: "text" as const })) : fields;
    const own = variants.filter((v) => v.product_id === p.id).flatMap((v) => {
      const price = v.price_amount ?? base;
      return price === null ? [] : [{ id: v.id, label: variantLabel(v.options, labels), price, externalId: v.external_id ?? null, keys: Object.keys(v.options ?? {}) }];
    });
    // A product is orderable with its own fixed price or, when it has variants, a priced variant.
    if (base === null && !own.length) return [];
    const variantKeys = new Set(own.flatMap((v) => v.keys));
    const declared = spec ? {
      options: spec.options.filter((o) => !variantKeys.has(o.key)),
      addons: spec.addons,
      fields: spec.fields.filter((f) => f.appliesTo === "item"),
    } : null;
    return [{ id: p.id, name: p.name, price: base ?? Math.min(...own.map((v) => v.price)), currency: p.currency, unit: p.price_unit ?? null,
      ...(own.length ? { variants: own.map((v) => ({ id: v.id, label: v.label, price: v.price, externalId: v.externalId })) } : {}),
      ...(declared ? { declared } : {}), sendsToWebsite: sendsOrders && p.source === "linked" }];
  }).slice(0, 20);
  return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
}
