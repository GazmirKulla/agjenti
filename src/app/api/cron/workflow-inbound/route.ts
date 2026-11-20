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
