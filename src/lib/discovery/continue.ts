import { createServiceSupabase } from "@/lib/supabase/service";
import { runDiscoveryQueue } from "./queue";

/** A scan runs in short leased steps. Each run does what fits in one function
 * call, then hands the rest to a fresh call of the discovery worker, so a scan
 * started from onboarding finishes without anyone keeping a page open. The
 * daily cron remains the safety net. */
export const MAX_HOPS = 40;
const MAX_WAIT_MS = 35_000;

export function workerOrigin(fallback?: string | null) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (fallback || configured || "").replace(/\/+$/, "") || null;
}

/** When the business's next step is due (ms from now), or null when nothing is left. */
async function nextDueIn(businessId: string) {
  const { data } = await createServiceSupabase().from("business_discovery_jobs").select("status,next_attempt_at,leased_until")
    .eq("business_id", businessId).in("status", ["queued", "running"]).order("next_attempt_at").limit(5);
  if (!data?.length) return null;
  const now = Date.now();
  return Math.min(...data.map((job) => Math.max(0, new Date(job.status === "running" && job.leased_until ? job.leased_until : job.next_attempt_at).getTime() - now)));
}

type Deps = { run?: typeof runDiscoveryQueue; dueIn?: typeof nextDueIn; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export async function continueDiscovery(businessId: string, origin: string | null, hop = 0, deps: Deps = {}) {
  const run = deps.run ?? runDiscoveryQueue, dueIn = deps.dueIn ?? nextDueIn;
  await run(businessId).catch(() => console.error("[discovery] worker unavailable"));
  const wait = await dueIn(businessId).catch(() => null);
  const secret = process.env.CRON_SECRET?.trim();
  // A retry further away, too many hops, or no way to call ourselves: the cron continues.
  if (wait === null || wait > MAX_WAIT_MS || hop + 1 >= MAX_HOPS || !secret || !origin) return false;
  if (wait > 0) await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(wait + 500);
  const url = new URL("/api/cron/business-discovery", origin);
  url.searchParams.set("business", businessId);
  url.searchParams.set("hop", String(hop + 1));
  try {
    // The next call answers at once and works after responding.
    const response = await (deps.fetcher ?? fetch)(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return response.ok;
  } catch {
    console.error("[discovery] next step was not started");
    return false;
  }
}
