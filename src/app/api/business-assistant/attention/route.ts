import { loadAttention } from "@/lib/business-assistant/attention";
import { BriefingError } from "@/lib/business-assistant/briefing";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json(await loadAttention(new URL(request.url).searchParams.get("slug") ?? ""),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: "Nuk u kontrolluan punët e biznesit." },
      { status: error instanceof BriefingError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
