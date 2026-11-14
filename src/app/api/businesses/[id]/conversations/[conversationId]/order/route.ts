import { NextResponse } from "next/server";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { dispatchManualOrder } from "@/lib/orders/dispatch";
import { createManualOrder, type OrderSelection } from "@/lib/orders/manual";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const field = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** Shape only; the RPC checks every key and value against the product's declaration. */
function readSelection(raw: unknown): OrderSelection | null | false {
  const body = record(raw);
  if (raw == null) return null;
  if (!body || JSON.stringify(body).length > 8000) return false;
  const options = record(body.options) ?? {}, fields = record(body.fields) ?? {}, files = record(body.files) ?? {};
  if (Object.values(options).some((v) => typeof v !== "string")) return false;
  if (Object.values(fields).some((v) => !["string", "number", "boolean"].includes(typeof v))) return false;
  if (Object.values(files).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== "string"))) return false;
  if (body.addons !== undefined && (!Array.isArray(body.addons) || body.addons.some((x) => typeof x !== "string"))) return false;
  return {
    options: options as Record<string, string>,
    fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== "")) as Record<string, string | number | boolean>,
    files: files as Record<string, string[]>,
    addons: (body.addons as string[] | undefined) ?? [],
  };
}

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
  const selection = readSelection(body?.selection);
  if (selection === false) return NextResponse.json({ error: "Zgjedhjet e produktit nuk janë të vlefshme." }, { status: 400 });
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
      selection,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    // The order is saved; sending it to the business website is recorded on its own and never repeated.
    const submission = await dispatchManualOrder({ businessId, userId: access.userId, orderId: result.orderId })
      .catch(() => ({ status: "pending_reconciliation" as const, reason: "dispatch_unverified" }));
    return NextResponse.json({ ok: true, orderId: result.orderId, submission });
  } catch (error) {
    if (error instanceof CapabilityEnforcementError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Porosia nuk u ruajt. Provo përsëri." }, { status: 500 });
  }
}
