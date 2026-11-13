import { NextResponse } from "next/server";
import { CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { localInstant } from "@/lib/calendar/model";
import { persistBooking } from "@/lib/calendar/service";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const field = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The owner books an appointment from this conversation through the Calendar's own writer. */
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const key = field(body?.requestKey, 100);
  if (key.length < 8) return NextResponse.json({ error: "Kërkesë e pavlefshme. Rifresko faqen." }, { status: 400 });
  const [conversation, settings] = await Promise.all([
    access.db.from("conversations").select("id").eq("business_id", businessId).eq("id", conversationId).maybeSingle(),
    access.db.from("business_calendar_settings").select("timezone").eq("business_id", businessId).maybeSingle(),
  ]);
  if (conversation.error || settings.error) return NextResponse.json({ error: "Takimi nuk u ruajt. Provo përsëri." }, { status: 500 });
  if (!conversation.data) return NextResponse.json({ error: "Biseda nuk u gjet në këtë biznes." }, { status: 404 });
  try {
    const start = localInstant(field(body?.date, 10), field(body?.time, 5), settings.data?.timezone ?? "Europe/Tirane");
    const result = await persistBooking(businessId, {
      serviceId: field(body?.serviceId, 36),
      name: field(body?.name, 120),
      contact: field(body?.contact, 200),
      notes: field(body?.notes, 1000),
      start,
      status: "confirmed",
      requestKey: `panel:${conversationId}:${key}`,
    });
    // Link it to this conversation so it shows in the panel.
    const link = await access.db.from("bookings").update({ conversation_id: conversationId })
      .eq("business_id", businessId).eq("id", result.booking.id);
    return NextResponse.json({
      ok: true,
      bookingId: result.booking.id,
      ...(link.error ? { warning: "Takimi u ruajt, por nuk u lidh me bisedën. Shihe te Rezervimet." } : {}),
      ...(result.syncError ? { warning: result.syncError } : {}),
    });
  } catch (error) {
    const status = error instanceof CapabilityEnforcementError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Takimi nuk u ruajt." }, { status });
  }
}
