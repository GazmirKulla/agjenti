import { BriefingError, loadBriefing } from "@/lib/business-assistant/briefing";
import { briefingPeriods, type BriefingPeriod } from "@/lib/business-assistant/briefing-model";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "today";
  if (!briefingPeriods.includes(period as BriefingPeriod)) return json({ error: "invalid_period" }, 400);
  try {
    return json(await loadBriefing(url.searchParams.get("slug") ?? "", period as BriefingPeriod));
  } catch (error) {
    return json({ error: "briefing_unavailable" }, error instanceof BriefingError ? error.status : 503);
  }
}
