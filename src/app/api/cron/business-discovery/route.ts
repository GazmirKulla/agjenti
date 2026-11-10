import { runDiscoveryQueue } from "@/lib/discovery/queue";
import { queuePendingUsernameScans } from "@/lib/discovery/instagram-username";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const queued = await queuePendingUsernameScans().catch(() => 0);
    return Response.json({ queued, processed: await runDiscoveryQueue() });
  }
  catch { return Response.json({ error: "Discovery worker unavailable" }, { status: 503 }); }
}
