import { after } from "next/server";
import { runDiscoveryQueue } from "@/lib/discovery/queue";
import { queuePendingUsernameScans } from "@/lib/discovery/instagram-username";
import { continueDiscovery, MAX_HOPS, workerOrigin } from "@/lib/discovery/continue";
export const runtime = "nodejs";
export const maxDuration = 180;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Daily safety net: everything due, plus usernames waiting for their scan. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const queued = await queuePendingUsernameScans().catch(() => 0);
    return Response.json({ queued, processed: await runDiscoveryQueue() });
  }
  catch { return Response.json({ error: "Discovery worker unavailable" }, { status: 503 }); }
}

/** The next step of one business's scan, handed over by the previous step. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const business = url.searchParams.get("business") ?? "";
  const hop = Number(url.searchParams.get("hop") ?? "0");
  if (!/^[0-9a-f-]{36}$/i.test(business) || !Number.isInteger(hop) || hop < 0 || hop >= MAX_HOPS)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  after(() => continueDiscovery(business, workerOrigin(url.origin), hop));
  return Response.json({ accepted: true }, { status: 202 });
}
