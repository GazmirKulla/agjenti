import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isTransportId } from "@/lib/conversations/transport-access";
import { loadBusinessApiSecret } from "@/lib/integrations/zana";
import { readExternalStatus, recordExternalStatus } from "@/lib/orders/external-status";
import { createServiceSupabase } from "@/lib/supabase/service";

type Context = { params: Promise<{ businessId: string }> };

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The business website tells Agjenti that an order it sent there has another status:
 * POST {"orderId", "status", "statusLabel", "changedAt"} with the business's API secret.
 * Only that business's orders change, and an older notice never replaces a newer one.
 */
export async function POST(request: Request, context: Context) {
  const { businessId } = await context.params;
  if (!isTransportId(businessId)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const secret = await loadBusinessApiSecret(businessId).catch(() => null);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !token || !sameSecret(token, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { orderId?: unknown; status?: unknown; statusLabel?: unknown; changedAt?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(body.orderId) ? body.orderId : null;
  const status = body ? readExternalStatus(body) : null;
  if (!orderId || !status) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  const db = createServiceSupabase();
  try {
    const updated = await recordExternalStatus(db, businessId, orderId, status);
    try {
      await db.from("integration_logs").insert({ business_id: businessId, direction: "inbound", target: "order_status", status: "ok", error: updated ? null : "order_unknown_or_older" });
    } catch { /* the status is kept either way */ }
    // An unknown order is not an error for the website: it has nothing to retry.
    return NextResponse.json({ ok: true, updated });
  } catch {
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 503 });
  }
}
