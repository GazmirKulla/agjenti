import { NextResponse } from "next/server";
import { attributeAiUsage, meteredRoute } from "@/lib/ai/usage";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { FORM_KINDS, prefillForm, type FormKind } from "@/lib/conversations/form-prefill";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only: the values "Krijo porosi", "Cakto takim" and "Ruaj kontaktin"
 * open with, read from the conversation (web Inbox and native app). */
async function handleGET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const kind = new URL(request.url).searchParams.get("form") as FormKind;
  if (!FORM_KINDS.includes(kind)) return NextResponse.json({ error: "Forma e panjohur." }, { status: 400 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  attributeAiUsage(businessId);
  try {
    const data = await prefillForm(access.db, businessId, conversationId, kind);
    if (!data) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[form-prefill]", error instanceof Error ? error.message.slice(0, 200) : "failed");
    return NextResponse.json({ error: "Biseda nuk u lexua. Plotëso formën vetë ose provo përsëri." }, { status: 503 });
  }
}

export const GET = meteredRoute(handleGET);
