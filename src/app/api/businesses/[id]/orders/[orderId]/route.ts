import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { amendOrder, readChangeValues, readOrderChanges } from "@/lib/orders/amend";

type Context = { params: Promise<{ id: string; orderId: string }> };
const noStore = { "Cache-Control": "private, no-store" };

/** The order's client and delivery details, note and items, whether they can still change, and the changes so far (web and app). */
export async function GET(request: Request, context: Context) {
  const { id: businessId, orderId } = await context.params;
  if (!isTransportId(orderId)) return NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const view = await readOrderChanges(businessId, orderId);
    if (!view) return NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 });
    return NextResponse.json(view, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Porosia nuk u lexua. Provo përsëri." }, { status: 503 });
  }
}

/**
 * Staff change the client and delivery details, the note and/or the items: `{ changeId, changes: { customer?, note?, lines? } }`.
 * The same changeId never changes the order twice; after an unclear answer the same request is sent again
 * (`{ changeId, retry: true }`).
 */
export async function PATCH(request: Request, context: Context) {
  const { id: businessId, orderId } = await context.params;
  if (!isTransportId(orderId)) return NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { changeId?: unknown; changes?: unknown; retry?: unknown } | null;
  // A retry (`retry: true`) names only the change: the stored one is sent again, never new values.
  const changes = body?.retry === true ? {} : readChangeValues(body?.changes);
  if (typeof body?.changeId !== "string" || !isTransportId(body.changeId) || !changes)
    return NextResponse.json({ error: "Të dhënat e ndryshimit nuk janë të vlefshme." }, { status: 400 });
  const outcome = await amendOrder({ businessId, userId: access.userId, orderId, changeId: body.changeId, changes });
  if (outcome.ok) return NextResponse.json({ ok: true, change: outcome.change });
  return NextResponse.json({ ok: false, error: outcome.error, ...(outcome.change ? { change: outcome.change } : {}) }, { status: outcome.status });
}
