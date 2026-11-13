import { NextResponse } from "next/server";
import { loadConversationContext } from "@/lib/conversations/context";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only panel data for the web Inbox and the native app (cookie or bearer). */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const data = await loadConversationContext(access.db, businessId, conversationId);
    if (!data) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Detajet e bisedës nuk u ngarkuan. Provo përsëri." }, { status: 503 });
  }
}
