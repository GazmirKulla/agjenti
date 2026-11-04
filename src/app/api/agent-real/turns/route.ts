import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { decryptSecret } from "@/lib/crypto/tokens";
import { runPanelChat } from "@/lib/agents/panel-chat/execute";
export const maxDuration = 180;
async function accessFor(request: Request) {
  const user = await getSessionUser();
  const access = user && await requireBusinessAccess(user.id, new URL(request.url).searchParams.get("slug") ?? "");
  const current = access && await transportAccess(access.business.id);
  if (!access || !current) return null;
  const { data, error } = await current.db.rpc("can_use_panel_chat", { p_business: access.business.id, p_user: current.userId });
  return !error && data === true ? { ...current, businessId: access.business.id } : null;
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Kërkesë e palejuar." }, { status: 403 });
  const access = await accessFor(request);
  if (!access) return NextResponse.json({ error: "Real chat kërkon pronarin ose administratorin." }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new Error("Kërkesë shumë e madhe.");
    const data = JSON.parse(raw);
    if (!isTransportId(data.streamId)) throw new Error("Bisedë e pavlefshme.");
    if (data.start === true && data.confirmRealActions === true) {
      const created = await access.db.rpc("create_panel_chat", { p_business: access.businessId, p_user: access.userId, p_stream: data.streamId });
      if (created.error) return NextResponse.json({ error: "Biseda reale nuk u hap." }, { status: 409 });
      return NextResponse.json({ streamId: data.streamId, mode: "real" }, { status: 201 });
    }
    // No test checkpoint, draft, fake media or arbitrary state may cross this boundary.
    if (!isTransportId(data.requestId) || !Number.isInteger(data.sequence) || data.sequence < 0 || data.sequence >= 40
      || !data.input || Object.keys(data.input).some(key => key !== "message")
      || typeof data.input.message !== "string" || !data.input.message.trim() || data.input.message.length > 2000) throw new Error("Dërgo një mesazh tekst në bisedën reale.");
    const message = data.input.message.trim();
    const fingerprint = createHash("sha256").update(JSON.stringify({ stream: data.streamId, sequence: data.sequence, message })).digest("hex");
    const { error } = await access.db.rpc("enqueue_panel_chat", { p_business: access.businessId, p_user: access.userId, p_stream: data.streamId,
      p_request: data.requestId, p_sequence: data.sequence, p_message: message, p_fingerprint: fingerprint });
    if (error) return NextResponse.json({ error: "Kërkesa nuk u pranua. Biseda mund të jetë ndalur ose ka skaduar; kontrollo statusin." }, { status: 409 });
    after(() => runPanelChat({ businessId: access.businessId, userId: access.userId, streamId: data.streamId }));
    return NextResponse.json({ accepted: true, requestId: data.requestId }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Kërkesë e pavlefshme." }, { status: 400 }); }
}
export async function GET(request: Request) {
  const access = await accessFor(request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stream = new URL(request.url).searchParams.get("stream");
  if (!isTransportId(stream)) return NextResponse.json({ error: "Invalid stream" }, { status: 400 });
  const { data, error } = await access.db.from("workflow_inbound_queue").select("client_request_id,client_sequence,status,error,result_ciphertext,payload,expires_at")
    .eq("business_id", access.businessId).eq("operator_user_id", access.userId).eq("test_stream_id", stream).eq("operation_kind", "panel").order("client_sequence").limit(40);
  if (error) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  const jobs = (data ?? []).map(job => ({ requestId: job.client_request_id, sequence: job.client_sequence,
    status: job.status !== "sent" && Date.parse(job.expires_at) <= Date.now() ? "failed" : job.status,
    error: job.error, message: job.payload.message, result: job.result_ciphertext ? JSON.parse(decryptSecret(job.result_ciphertext)) : null }));
  if (jobs.some(job => ["queued", "processing"].includes(job.status))) after(() => runPanelChat({ businessId: access.businessId, userId: access.userId, streamId: stream }));
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
