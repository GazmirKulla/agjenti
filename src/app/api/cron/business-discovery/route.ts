import { runDiscoveryQueue } from "@/lib/discovery/queue";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json({ processed: await runDiscoveryQueue() }); }
  catch { return Response.json({ error: "Discovery worker unavailable" }, { status: 503 }); }
}
