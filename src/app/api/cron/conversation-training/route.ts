import { after } from "next/server";
import { continueTraining, MAX_HOPS, workerOrigin } from "@/lib/conversation-training/continue";
import { purgeExpiredTraining, runTrainingQueue } from "@/lib/conversation-training/job";
export const runtime = "nodejs";
export const maxDuration = 180;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Daily safety net: imports still due, and deletion of imports past retention. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const purged = await purgeExpiredTraining().catch(() => 0);
    return Response.json({ purged, processed: await runTrainingQueue() });
  } catch { return Response.json({ error: "Training worker unavailable" }, { status: 503 }); }
}

/** The next step of one business's import, handed over by the previous step. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const business = url.searchParams.get("business") ?? "";
  const hop = Number(url.searchParams.get("hop") ?? "0");
  if (!/^[0-9a-f-]{36}$/i.test(business) || !Number.isInteger(hop) || hop < 0 || hop >= MAX_HOPS)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  after(() => continueTraining(business, workerOrigin(url.origin), hop));
  return Response.json({ accepted: true }, { status: 202 });
}
