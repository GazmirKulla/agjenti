import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { readTestSession } from "@/lib/agents/test-chat/session";
import { decryptSecret } from "@/lib/crypto/tokens";
import { runWorkflowQueue } from "@/lib/conversations/workflow-queue";
import { fragmentKind } from "@/lib/conversations/message-batch";
import type { TestChatInput, TestChatResult } from "@/lib/agents/test-chat/actions";
export const maxDuration = 180;
async function accessFor(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const user = await getSessionUser();
  const access = user && await requireBusinessAccess(user.id, slug);
  const current = access && await transportAccess(access.business.id);
  return current && access ? { ...current, businessId: access.business.id, slug } : null;
}
export async function POST(request: Request) {
  const access = await accessFor(request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 500000) throw new Error("Kërkesa është shumë e madhe.");
    const data = JSON.parse(raw);
    if (!isTransportId(data.requestId) || !isTransportId(data.streamId) || !Number.isInteger(data.sequence) || data.sequence < 0 || data.sequence >= 40) throw new Error("Identiteti i kërkesës nuk është i vlefshëm.");
    const input: TestChatInput = { slug: access.slug, message: data.input?.message, hasMedia: data.input?.hasMedia === true, session: data.input?.session ?? null, attachments: data.input?.attachments ?? [] };
    if (typeof input.message !== "string" || input.message.length > 2000 || !Array.isArray(input.attachments) || input.attachments.length > 3 || input.attachments.some(t => typeof t !== "string" || t.length > 100000)) throw new Error("Mesazh i pavlefshëm.");
    const session = readTestSession(input.session ?? null, access.userId, access.businessId);
    const { data: prior, error: priorError } = await access.db.from("workflow_inbound_queue").select("id")
      .eq("business_id", access.businessId).eq("operator_user_id", access.userId).eq("test_stream_id", data.streamId).limit(1).maybeSingle();
    if (priorError) return NextResponse.json({ error: "Radha nuk u lexua. Kërkesa nuk u pranua." }, { status: 503 });
    // A fork may start at a non-zero, authenticated checkpoint. A new empty
    // stream must not skip a locally failed/unaccepted preceding message.
    if (!prior && data.sequence !== session.turns) return NextResponse.json({ error: "Mungon mesazhi i mëparshëm." }, { status: 409 });
    const fingerprint = createHash("sha256").update(JSON.stringify({ input, stream: data.streamId, sequence: data.sequence })).digest("hex");
    const payload = { ...input, fragmentKind: fragmentKind(input.message, input.hasMedia || Boolean(input.attachments?.length)) };
    const { data: job, error } = await access.db.rpc("enqueue_transport_operation", { p_business: access.businessId, p_user: access.userId, p_request: data.requestId, p_kind: "test", p_scope: data.streamId, p_sequence: data.sequence, p_fingerprint: fingerprint, p_payload: payload });
    if (error) return NextResponse.json({ error: "Kërkesa nuk u pranua. Rifresko statusin; mos krijo identitet të ri për retry." }, { status: 409 });
    if (data.retry === true && job.batch_parent_id) return NextResponse.json({ error: "Riprovo kërkesën e parë të grupit, me të njëjtin identitet." }, { status: 409 });
    if (data.retry === true && job.status === "failed") {
      const { data: retried, error: retryError } = await access.db.from("workflow_inbound_queue").update({ status: "queued", leased_until: null, error: null })
        .eq("id", job.id).eq("operator_user_id", access.userId).eq("status", "failed").lt("attempts", 3).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
      if (retryError || !retried) return NextResponse.json({ error: "Retry nuk u pranua: kufiri i provave ose sesioni ka skaduar." }, { status: 409 });
    }
    after(() => runWorkflowQueue(10, { businessId: access.businessId, userId: access.userId, streamId: data.streamId }).then(() => {}));
    return NextResponse.json({ requestId: data.requestId, accepted: true }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Kërkesë e pavlefshme." }, { status: 400 }); }
}
export async function GET(request: Request) {
  const access = await accessFor(request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stream = new URL(request.url).searchParams.get("stream");
  if (!isTransportId(stream)) return NextResponse.json({ error: "Invalid stream" }, { status: 400 });
  const { data, error } = await access.db.from("workflow_inbound_queue").select("id,batch_parent_id,client_request_id,client_sequence,status,error,result_ciphertext,expires_at")
    .eq("business_id", access.businessId).eq("operator_user_id", access.userId).eq("test_stream_id", stream).eq("operation_kind", "test").order("client_sequence").limit(40);
  if (error) return NextResponse.json({ error: "Statusi nuk u ngarkua." }, { status: 503 });
  const rows = data ?? [];
  const results = new Map<number, TestChatResult>();
  const jobs = rows.map(job => {
    // Resolve only inside this already-authorized private stream, never by an
    // unscoped parent ID. Children keep their identities and share one outcome.
    const owner = job.batch_parent_id ? rows.find(row => row.id === job.batch_parent_id) : job;
    if (!owner) return { requestId: job.client_request_id, sequence: job.client_sequence, status: "failed", error: "Grupi nuk u gjet.", result: null };
    const expired = Date.parse(owner.expires_at) <= Date.now();
    let result: TestChatResult | null = null;
    if (!expired && owner.result_ciphertext) {
      result = results.get(owner.id) ?? JSON.parse(decryptSecret(owner.result_ciphertext));
      if (result) results.set(owner.id, result);
    }
    const grouped = job.batch_parent_id || rows.some(row => row.batch_parent_id === job.id);
    return { requestId: job.client_request_id, sequence: job.client_sequence, batchId: grouped ? owner.client_request_id : undefined, status: expired && owner.status !== "sent" ? "failed" : owner.status, error: expired ? "Sesioni ka skaduar; rezultati nuk mund të rikthehet." : owner.error, result };
  });
  if (jobs.some(j => ["queued", "processing"].includes(j.status))) after(() => runWorkflowQueue(10, { businessId: access.businessId, userId: access.userId, streamId: stream }).then(() => {}));
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
