import { InboxReadError, loadInboxPage, parseCursor } from "@/lib/conversations/inbox-read";
import { mobileInboxAccess, mobileInboxError, mobileInboxHeaders } from "@/lib/mobile/inbox";

export const runtime = "nodejs";

/** One page of the Inbox (newest first). `?before=<next>` reads the page after it. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await mobileInboxAccess(request, url.searchParams.get("slug") ?? "");
  if (access.status !== 200) return mobileInboxError(access.status);
  try {
    const page = await loadInboxPage(access.db, access.businessId, {
      before: parseCursor(url.searchParams.get("before")),
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return Response.json({ businessId: access.businessId, conversations: page.rows, next: page.next }, { headers: mobileInboxHeaders });
  } catch (error) {
    if (error instanceof InboxReadError) return mobileInboxError(503);
    throw error;
  }
}
