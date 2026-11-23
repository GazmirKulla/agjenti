import { after } from "next/server";
import { continueTransport, MAX_TRANSPORT_HOPS, type TransportWork } from "@/lib/conversations/continue";
import { isTransportId } from "@/lib/conversations/transport-access";
import { runWorkflowQueue } from "@/lib/conversations/workflow-queue";
import { createServiceSupabase } from "@/lib/supabase/service";
import { trackScheduledJob } from "@/lib/tracking/system-events";
export const runtime = "nodejs";
export const maxDuration = 180;
async function runJob(request: Request) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const processed = await runWorkflowQueue();
        const { data: privateJobs, error: jobsError } = await createServiceSupabase().from("workflow_inbound_queue")
          .select("operation_kind,business_id,operator_user_id,test_stream_id").in("operation_kind", ["panel", "test"])
          .in("status", ["queued", "processing"]).gt("expires_at", new Date().toISOString()).limit(100);
        if (jobsError) throw new Error("Private work recovery unavailable");
        const work = new Map<string, TransportWork>();
        for (const job of privateJobs ?? []) work.set(`${job.operation_kind}:${job.business_id}:${job.operator_user_id}:${job.test_stream_id}`, {
          kind: job.operation_kind as "panel" | "test", scope: { businessId: job.business_id, userId: job.operator_user_id, streamId: job.test_stream_id },
        });
        after(async () => { await Promise.all([continueTransport(), ...[...work.values()].map(item => continueTransport(item))]); });
        // Old deployments keep working before the additive health migration.
        const health = await createServiceSupabase().from("workflow_worker_health").upsert({ id: true, last_success_at: new Date().toISOString(), processed });
        if (health.error && !["42P01", "PGRST205"].includes(health.error.code)) throw new Error("Worker heartbeat failed");
        return Response.json({ processed });
    }
    catch {
        return Response.json({ error: "Workflow worker unavailable" }, { status: 503 });
    }
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("workflow-inbound", () => runJob(request));

/** Authenticated handoff acknowledges immediately; execution remains server-owned. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { work, hop } = await request.json();
    if (!Number.isInteger(hop) || hop < 1 || hop > MAX_TRANSPORT_HOPS || !work || !["inbound", "test", "panel"].includes(work.kind)
      || (work.kind !== "inbound" && (!isTransportId(work.scope?.businessId) || !isTransportId(work.scope?.userId) || !isTransportId(work.scope?.streamId))))
      return Response.json({ error: "Invalid handoff" }, { status: 400 });
    after(() => continueTransport(work, hop));
    return Response.json({ accepted: true }, { status: 202 });
  } catch { return Response.json({ error: "Invalid handoff" }, { status: 400 }); }
}
