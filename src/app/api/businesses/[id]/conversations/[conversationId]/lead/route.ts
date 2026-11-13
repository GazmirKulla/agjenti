import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { leadStatuses, changeLeadStatus } from "@/lib/leads/status";
import type { LeadStatus } from "@/lib/leads/model";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Moves this conversation's lead to another status (web panel and native app). */
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { leadId?: unknown; status?: unknown } | null;
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  const status = body?.status as LeadStatus;
  if (!isTransportId(leadId) || !leadStatuses.includes(status)) return NextResponse.json({ error: "Kërkesë e pavlefshme." }, { status: 400 });
  // The lead must belong to this conversation, not only to this business.
  const { data, error } = await access.db.from("leads").select("id").eq("id", leadId)
    .eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle();
  if (error) return NextResponse.json({ error: "Statusi nuk u ndryshua. Provo përsëri." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Lead-i nuk u gjet. Rifresko faqen." }, { status: 404 });
  const result = await changeLeadStatus(businessId, access.userId, leadId, status);
  if (result.error)
    return NextResponse.json({ error: result.error }, { status: result.error.includes("nuk u gjet") ? 404 : result.error.includes("hapur") ? 409 : 500 });
  return NextResponse.json({ ok: true, message: result.success });
}
