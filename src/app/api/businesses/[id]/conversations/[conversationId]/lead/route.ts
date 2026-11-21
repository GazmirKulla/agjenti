import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { changeConversationLead } from "@/lib/leads/status";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/model";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/**
 * Moves this conversation's lead to another status (web panel and native app). The lead is the
 * conversation's own state; app versions that still send a leadId get the conversation's id back as it.
 */
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status as LeadStatus;
  if (!LEAD_STATUSES.includes(status)) return NextResponse.json({ error: "Kërkesë e pavlefshme." }, { status: 400 });
  const result = await changeConversationLead(businessId, access.userId, conversationId, status);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.error.includes("nuk u gjet") ? 404 : 500 });
  return NextResponse.json({ ok: true, message: result.success });
}
