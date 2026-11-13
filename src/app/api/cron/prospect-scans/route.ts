import { after } from "next/server";
import { runDueProspectScans, runProspectScan } from "@/lib/prospects/instagram-scan";
export const runtime = "nodejs";
export const maxDuration = 180;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Daily safety net: scans whose wake-up was lost, and expired reads removed. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json({ processed: await runDueProspectScans() }); }
  catch { return Response.json({ error: "Prospect scan worker unavailable" }, { status: 503 }); }
}

/** One scan queued by the customer agent; answers at once and reads after responding. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const scan = new URL(request.url).searchParams.get("scan") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(scan)) return Response.json({ error: "invalid_request" }, { status: 400 });
  after(() => runProspectScan(scan).catch(() => console.error("[prospect-scan] worker failed")));
  return Response.json({ accepted: true }, { status: 202 });
}
