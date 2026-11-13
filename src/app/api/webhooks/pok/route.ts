import { BillingError, syncPlanPayment } from "@/lib/billing/payments";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POK calls this when an order changes. The body is not trusted: the payment
 * named in our own webhook URL is re-checked against POK's merchant API. */
export async function POST(request: Request) {
  const payment = new URL(request.url).searchParams.get("payment");
  if (!payment || !uuid.test(payment)) return Response.json({ ok: false }, { status: 400 });
  try {
    await syncPlanPayment(payment);
    return Response.json({ ok: true });
  } catch (cause) {
    if (cause instanceof BillingError && cause.status === 404) return Response.json({ ok: false });
    console.error("[pok] webhook", cause instanceof Error ? cause.message : cause);
    // A 5xx lets POK retry later.
    return Response.json({ ok: false }, { status: 500 });
  }
}
