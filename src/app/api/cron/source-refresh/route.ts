import { createServiceSupabase } from "@/lib/supabase/service";
import { workerOrigin } from "@/lib/discovery/continue";
import { refreshBusinessSources } from "@/lib/knowledge/source-refresh";
import { recordSystem, stepFailure, trackScheduledJob } from "@/lib/tracking/system-events";
export const maxDuration = 60;
const PER_RUN = 20;
const WEEK = 7 * 86400000;

/**
 * Weekly: reads again the sources of businesses that answer customers (auto replies on) and were not read
 * in the last 7 days. Each read ends as a proposal the owner reviews; nothing the owner wrote is replaced.
 */
async function runJob(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceSupabase();
  const { data: live, error } = await db.from("businesses").select("id").eq("auto_reply", true).limit(500);
  if (error) return Response.json({ error: "Bizneset nuk u lexuan." }, { status: 503 });
  const results: { businessId: string; website: boolean; instagram: boolean }[] = [];
  for (const business of live ?? []) {
    if (results.length >= PER_RUN) break;
    const [{ data: last }, { data: owner }] = await Promise.all([
      db.from("business_discovery_jobs").select("updated_at").eq("business_id", business.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("business_users").select("user_id").eq("business_id", business.id).eq("role", "owner").limit(1).maybeSingle(),
    ]);
    if (!owner || (last && Date.now() - Date.parse(last.updated_at) < WEEK)) continue;
    try {
      const queued = await refreshBusinessSources(business.id, owner.user_id, workerOrigin(null));
      if (queued.website || queued.instagram) {
        results.push({ businessId: business.id, website: Boolean(queued.website), instagram: Boolean(queued.instagram) });
        await recordSystem("system.source_refresh", "queued", { businessId: business.id });
      } else await recordSystem("system.source_refresh", "failed", { businessId: business.id, reason: "nothing_queued" });
    } catch (error) { await recordSystem("system.source_refresh", "failed", { businessId: business.id, reason: stepFailure("system.source_refresh", "refresh", error) }); /* the next run tries again */ }
  }
  return Response.json({ refreshed: results.length });
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("source-refresh", () => runJob(request));
