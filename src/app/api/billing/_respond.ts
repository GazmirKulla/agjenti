import { BillingError } from "@/lib/billing/payments";

export const noStore = { "Cache-Control": "no-store" };

export function failure(cause: unknown) {
  if (cause instanceof BillingError)
    return Response.json({ error: cause.message }, { status: cause.status, headers: noStore });
  console.error("[billing] route", cause instanceof Error ? cause.message : cause);
  return Response.json({ error: "Diçka nuk shkoi. Provo përsëri." }, { status: 500, headers: noStore });
}
