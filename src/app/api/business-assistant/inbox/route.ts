import {
  loadRecentInbox,
  RecentInboxError,
} from "@/lib/business-assistant/recent-inbox";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(request: Request) {
  try {
    return json(
      await loadRecentInbox(
        new URL(request.url).searchParams.get("slug") ?? "",
        request,
      ),
    );
  } catch (error) {
    return json(
      { error: "Bisedat nuk u ngarkuan." },
      error instanceof RecentInboxError ? error.status : 503,
    );
  }
}
