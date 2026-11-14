import { createServiceSupabase } from "@/lib/supabase/service";
import { workerOrigin } from "@/lib/discovery/continue";
import { runTrainingQueue } from "./job";

/** An import runs in short leased steps; each call does what fits and hands the
 * rest to a fresh call of the worker, so it finishes without an open page. The
 * daily cron is the safety net. */
export const MAX_HOPS = 200;
const MAX_WAIT_MS = 35_000;
export { workerOrigin };

async function nextDueIn(businessId: string) {
  const { data } = await createServiceSupabase().from("conversation_training_sessions").select("status,next_attempt_at,leased_until")
    .eq("business_id", businessId).in("status", ["queued", "running"]).limit(3);
  if (!data?.length) return null;
  const now = Date.now();
  return Math.min(...data.map((s) => Math.max(0, new Date(s.status === "running" && s.leased_until ? s.leased_until : s.next_attempt_at).getTime() - now)));
}

type Deps = { run?: typeof runTrainingQueue; dueIn?: typeof nextDueIn; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export async function continueTraining(businessId: string, origin: string | null, hop = 0, deps: Deps = {}) {
  await (deps.run ?? runTrainingQueue)(businessId).catch(() => console.error("[conversation-training] worker unavailable"));
  const wait = await (deps.dueIn ?? nextDueIn)(businessId).catch(() => null);
  const secret = process.env.CRON_SECRET?.trim();
  if (wait === null || wait > MAX_WAIT_MS || hop + 1 >= MAX_HOPS || !secret || !origin) return false;
  if (wait > 0) await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(wait + 500);
  const url = new URL("/api/cron/conversation-training", origin);
  url.searchParams.set("business", businessId);
  url.searchParams.set("hop", String(hop + 1));
  try {
    const response = await (deps.fetcher ?? fetch)(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return response.ok;
  } catch {
    console.error("[conversation-training] next step was not started");
    return false;
  }
}
