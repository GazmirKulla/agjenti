import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { runWorkflowQueue } from "@/lib/conversations/workflow-queue";

export const maxDuration = 180;
type Context = { params: Promise<{ id: string; conversationId: string }> };
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  const access = await transportAccess(businessId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 25000) throw new Error("Mesazhi është shumë i gjatë.");
    const body = JSON.parse(raw);
    if (!isTransportId(body.requestId) || !isTransportId(conversationId) || typeof body.body !== "string" || !body.body.trim() || body.body.length > 20000) throw new Error("Mesazh ose identitet i pavlefshëm.");
    const text = body.body.trim();
    const isRetry = body.retryAttempt !== undefined;
    if (isRetry && (!Number.isInteger(body.retryAttempt) || body.retryAttempt < 1 || body.retryAttempt > 3)) return NextResponse.json({ error: "Provë e pavlefshme." }, { status: 400 });
    const { data, error } = await access.db.rpc(isRetry ? "retry_staff_transport" : "enqueue_transport_operation", isRetry ? {
      p_business: businessId, p_user: access.userId, p_conversation: conversationId, p_request: body.requestId, p_attempt: body.retryAttempt,
    } : {
      p_business: businessId, p_user: access.userId, p_request: body.requestId, p_kind: "staff", p_scope: conversationId,
      p_sequence: null, p_fingerprint: createHash("sha256").update(JSON.stringify({ conversationId, text })).digest("hex"), p_payload: { body: text },
    });
    if (error) return NextResponse.json({ error: "Mesazhi nuk u pranua. Kontrollo bisedën, lejet dhe dritaren 24-orëshe.", code: "transport_rejected" }, { status: 409 });
    after(() => runWorkflowQueue().then(() => {}));
    return NextResponse.json({ accepted: true, requestId: body.requestId, status: data.status }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kërkesë e pavlefshme." }, { status: 400 });
  }
}
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  const access = await transportAccess(businessId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: conversation, error: lookupError } = await access.db.from("conversations").select("id").eq("business_id", businessId).eq("id", conversationId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await access.db.from("workflow_inbound_queue").select("client_request_id,status,error,reply,created_at,provider_message_id,attempts,operator_user_id,message_transport_parts(part_index,status,external_message_id)")
    .eq("business_id", businessId).eq("conversation_id", conversationId).eq("operation_kind", "staff").order("id", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  if (data?.some(j => ["queued", "prepared", "processing", "sending"].includes(j.status))) after(() => runWorkflowQueue().then(() => {}));
  return NextResponse.json({ jobs: (data ?? []).reverse().map(j => ({ requestId: j.client_request_id, status: j.status, error: j.error, body: j.reply, createdAt: j.created_at, attempts: j.attempts,
    canRetry: j.operator_user_id === access.userId && j.status === "uncertain" && j.attempts < 3 && j.message_transport_parts?.length === 1 && j.message_transport_parts[0].part_index === 0 && j.message_transport_parts[0].status === "failed" && !j.message_transport_parts[0].external_message_id,
  })) }, { headers: { "Cache-Control": "no-store" } });
}
