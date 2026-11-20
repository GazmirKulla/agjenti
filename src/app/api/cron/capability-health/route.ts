import { createServiceSupabase } from "@/lib/supabase/service";
import { trackScheduledJob } from "@/lib/tracking/system-events";
export const maxDuration = 60;
/** Daily: records started processes that never ended as abandoned, then removes events older than 90 days. */
async function runJob(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceSupabase();
  const [abandoned, pruned] = [await db.rpc("mark_abandoned_capabilities", { p_hours: 24 }), await db.rpc("prune_capability_events", { p_days: 90 })];
  if (abandoned.error || pruned.error) return Response.json({ error: "Matja ditore nuk u përfundua." }, { status: 503 });
  return Response.json({ abandoned: abandoned.data, pruned: pruned.data });
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("capability-health", () => runJob(request));
