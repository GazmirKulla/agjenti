import { monitorBusinessAttention } from "@/lib/business-assistant/attention-monitor";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await monitorBusinessAttention()); }
  catch { return Response.json({ error: "Ndjekja nuk u përfundua." }, { status: 503 }); }
}
