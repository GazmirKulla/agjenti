import { continueTransport } from "@/lib/conversations/continue";
import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { staffPhotoToSend } from "@/lib/conversations/staff-photo";

export const maxDuration = 180;
type Context = { params: Promise<{ id: string; conversationId: string }> };
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 25000) throw new Error("Mesazhi është shumë i gjatë.");
    const body = JSON.parse(raw);
    // A photo (an order's processed design, one uploaded for this conversation, or a product's), with an optional caption.
    const withPhoto = body.media !== undefined && body.media !== null;
    const caption = typeof body.body === "string" ? body.body.trim() : "";
    if (!isTransportId(body.requestId) || !isTransportId(conversationId) || (!withPhoto && !caption) || caption.length > (withPhoto ? 1000 : 20000)
      || (body.body !== undefined && typeof body.body !== "string")) throw new Error("Mesazh ose identitet i pavlefshëm.");
    const text = caption;
    const photo = withPhoto && body.retryAttempt === undefined ? await staffPhotoToSend(businessId, conversationId, body.media) : null;
    if (withPhoto && body.retryAttempt === undefined && !photo) return NextResponse.json({ error: "Kjo foto nuk mund të dërgohet. Zgjidh një foto tjetër." }, { status: 400 });
    const isRetry = body.retryAttempt !== undefined;
    if (isRetry && (!Number.isInteger(body.retryAttempt) || body.retryAttempt < 1 || body.retryAttempt > 3)) return NextResponse.json({ error: "Provë e pavlefshme." }, { status: 400 });
    const { data, error } = await access.db.rpc(isRetry ? "retry_staff_transport" : "enqueue_transport_operation", isRetry ? {
      p_business: businessId, p_user: access.userId, p_conversation: conversationId, p_request: body.requestId, p_attempt: body.retryAttempt,
    } : {
      p_business: businessId, p_user: access.userId, p_request: body.requestId, p_kind: "staff", p_scope: conversationId,
      p_sequence: null, p_fingerprint: createHash("sha256").update(JSON.stringify(photo ? { conversationId, text, photo: photo.identity } : { conversationId, text })).digest("hex"),
      p_payload: photo ? { body: text, media: { kind: "image", url: photo.url } } : { body: text },
    });
    if (error) return NextResponse.json({ error: "Mesazhi nuk u pranua. Kontrollo bisedën, lejet dhe afatin e përgjigjes (Instagram manual: 7 ditë; WhatsApp: 24 orë).", code: "transport_rejected" }, { status: 409 });
    after(() => continueTransport());
    return NextResponse.json({ accepted: true, requestId: body.requestId, status: data.status }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kërkesë e pavlefshme." }, { status: 400 });
  }
}
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Both reads are scoped to this business; the jobs are returned only once the conversation is confirmed here.
  const [lookup, jobs] = await Promise.all([
    access.db.from("conversations").select("id").eq("business_id", businessId).eq("id", conversationId).maybeSingle(),
    access.db.from("workflow_inbound_queue").select("client_request_id,status,error,reply,created_at,provider_message_id,attempts,operator_user_id,message_transport_parts(part_index,status,external_message_id)")
      .eq("business_id", businessId).eq("conversation_id", conversationId).eq("operation_kind", "staff").order("id", { ascending: false }).limit(100),
  ]);
  const { data: conversation, error: lookupError } = lookup;
  if (lookupError) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = jobs;
  if (error) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  // A send whose message is already in the thread shows there, at its own time (with its error if it failed);
  // only the ones not stored yet are shown as in progress under the latest message.
  const requestIds = (data ?? []).flatMap(j => typeof j.client_request_id === "string" ? [j.client_request_id] : []);
  const storedRead = requestIds.length ? await access.db.from("messages").select("transport_request_id")
    .eq("business_id", businessId).eq("conversation_id", conversationId).in("transport_request_id", requestIds) : { data: [], error: null };
  if (storedRead.error) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  const stored = new Set((storedRead.data ?? []).map(m => m.transport_request_id));
  return NextResponse.json({ jobs: (data ?? []).reverse().map(j => ({ requestId: j.client_request_id, status: j.status, error: j.error, body: j.reply, createdAt: j.created_at, attempts: j.attempts,
    stored: stored.has(j.client_request_id),
    canRetry: j.operator_user_id === access.userId && j.status === "uncertain" && j.attempts < 3 && j.message_transport_parts?.length === 1 && j.message_transport_parts[0].part_index === 0 && j.message_transport_parts[0].status === "failed" && !j.message_transport_parts[0].external_message_id,
  })) }, { headers: { "Cache-Control": "no-store" } });
}
