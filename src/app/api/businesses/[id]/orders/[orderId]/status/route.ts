import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { changeExternalOrderStatus, fetchExternalOrder, STATUS_KEY } from "@/lib/integrations/zana";
import { recordExternalStatus, statusOfView } from "@/lib/orders/external-status";

type Context = { params: Promise<{ id: string; orderId: string }> };
const noStore = { "Cache-Control": "private, no-store" };

/** A member of the business and an order of that business sent to its website (or not). */
async function open(request: Request, context: Context) {
  const { id: businessId, orderId } = await context.params;
  if (!isTransportId(orderId)) return { response: NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 }) };
  const access = await transportAccess(businessId, request);
  if (!access) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const { data: order, error } = await access.db.from("orders")
    .select("id,external_order_id,external_system,external_status,external_status_label,external_status_at")
    .eq("id", orderId).eq("business_id", businessId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Porosia nuk u lexua." }, { status: 503 }) };
  if (!order) return { response: NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 }) };
  const external = order.external_system === "external" && typeof order.external_order_id === "string" ? order.external_order_id : null;
  return { businessId, db: access.db, order, external };
}

/** The order's status on the business website and the statuses it can move to, read from the website now. */
export async function GET(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { businessId, db, order, external } = opened;
  if (!external) return NextResponse.json({ sent: false }, { headers: noStore });
  const kept = { status: order.external_status, statusLabel: order.external_status_label, at: order.external_status_at };
  const view = await fetchExternalOrder(businessId, external);
  const status = view ? statusOfView(view) : null;
  if (!view || !status) return NextResponse.json({ sent: true, ...kept, statuses: [], error: "Statusi nuk u lexua nga webi i biznesit." }, { headers: noStore });
  await recordExternalStatus(db, businessId, external, status).catch(() => false);
  return NextResponse.json({ sent: true, status: status.status, statusLabel: status.label, at: status.at, statuses: view.statuses ?? [] }, { headers: noStore });
}

/** Moves the order to another of the website's statuses; shown changed only after the website confirms it. */
export async function POST(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { businessId, db, external } = opened;
  if (!external) return NextResponse.json({ error: "Kjo porosi nuk është dërguar në webin e biznesit." }, { status: 409 });
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  const next = typeof body?.status === "string" ? body.status : "";
  if (!STATUS_KEY.test(next)) return NextResponse.json({ error: "Statusi nuk është i vlefshëm." }, { status: 400 });
  const result = await changeExternalOrderStatus(businessId, external, next);
  if (!result.ok) {
    if (result.uncertain) return NextResponse.json({ ok: false, uncertain: true, error: "Webi nuk u përgjigj. Rifresko statusin para se ta provosh sërish." }, { status: 202 });
    const reasons: Record<string, string> = {
      status_changed: "Statusi ndryshoi ndërkohë në web. Rifresko dhe provo sërish.",
      payment_not_confirmed: "Webi nuk e lejon këtë status pa pagesë të konfirmuar.",
      invalid_status: "Webi nuk e njeh këtë status.",
      integration_unavailable: "Lidhja me webin e biznesit nuk është e plotë.",
    };
    return NextResponse.json({ ok: false, error: (result.code && reasons[result.code]) || "Webi e refuzoi ndryshimin e statusit." }, { status: 409 });
  }
  const status = statusOfView(result.view);
  if (status) await recordExternalStatus(db, businessId, external, status).catch(() => false);
  return NextResponse.json({ ok: true, status: status?.status ?? result.view.status, statusLabel: status?.label ?? result.view.status,
    at: status?.at ?? null, statuses: result.view.statuses ?? [] }, { headers: noStore });
}
