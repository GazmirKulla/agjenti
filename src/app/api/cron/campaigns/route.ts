import { createServiceSupabase } from "@/lib/supabase/service";
import { after } from "next/server";
import { continueCampaigns, runCampaignQueue } from "@/lib/campaigns/worker";
import { isTransportId } from "@/lib/conversations/transport-access";
import { trackScheduledJob } from "@/lib/tracking/system-events";
export const runtime = "nodejs";
export const maxDuration = 120;
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}
async function runJob(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await runCampaignQueue();
    const running = await createServiceSupabase().from("marketing_campaigns").select("business_id").eq("status", "running").order("confirmed_at").limit(20);
    if (running.error) throw new Error("Queue unavailable");
    const businesses = [...new Set((running.data ?? []).map(c => c.business_id))];
    if (businesses.length) after(async () => { await Promise.all(businesses.map(id => continueCampaigns(id))); });
    return Response.json({ ok: true });
  }
  catch { return Response.json({ error: "Worker unavailable" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const value = await request.json().catch(() => null);
  if (!value || !isTransportId(value.businessId) || !Number.isInteger(value.hop) || value.hop < 0 || value.hop > 199) return Response.json({ error: "Invalid request" }, { status: 400 });
  after(() => continueCampaigns(value.businessId, value.hop));
  return Response.json({ accepted: true }, { status: 202 });
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("campaigns", () => runJob(request));
