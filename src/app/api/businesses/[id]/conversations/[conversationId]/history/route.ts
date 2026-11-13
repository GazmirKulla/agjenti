import { NextResponse } from "next/server";
import { InboxReadError, loadThreadPage, parseCursor } from "@/lib/conversations/inbox-read";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only: older messages for the web Inbox ("Shiko mesazhet më të hershme"). */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const before = parseCursor(new URL(request.url).searchParams.get("before"));
  if (!before) return NextResponse.json({ error: "Kërkesë e pavlefshme." }, { status: 400 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: conversation, error } = await access.db.from("conversations").select("id")
    .eq("business_id", businessId).eq("id", conversationId).maybeSingle();
  if (error) return NextResponse.json({ error: "Mesazhet nuk u ngarkuan." }, { status: 503 });
  if (!conversation) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  try {
    const page = await loadThreadPage(access.db, businessId, conversationId, { before });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (failure) {
    if (failure instanceof InboxReadError) return NextResponse.json({ error: "Mesazhet nuk u ngarkuan." }, { status: 503 });
    throw failure;
  }
}
