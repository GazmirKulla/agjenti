import { NextResponse } from "next/server";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { createManualOrder } from "@/lib/orders/manual";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const field = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The owner records a local order from this conversation (web panel and native app). */
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const customer = (body?.customer ?? {}) as Record<string, unknown>;
  const productId = field(body?.productId, 36);
  const quantity = Number(body?.quantity);
  const requestKey = field(body?.requestKey, 200);
  const variantId = field(body?.variantId, 36) || null;
  if (!isTransportId(productId) || !Number.isFinite(quantity) || quantity <= 0 || requestKey.length < 8 || (variantId && !isTransportId(variantId)))
    return NextResponse.json({ error: "Zgjidh produktin dhe sasinë." }, { status: 400 });
  try {
    const result = await createManualOrder({
      businessId,
      userId: access.userId,
      conversationId,
      productId,
      variantId,
      quantity,
      customer: { name: field(customer.name, 120), phone: field(customer.phone, 40), city: field(customer.city, 120), address: field(customer.address, 300) },
      note: field(body?.note, 1000),
      requestKey,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, orderId: result.orderId });
  } catch (error) {
    if (error instanceof CapabilityEnforcementError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Porosia nuk u ruajt. Provo përsëri." }, { status: 500 });
  }
}
