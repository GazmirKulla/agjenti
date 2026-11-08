import { InboxReadError, loadInboxRows } from "@/lib/conversations/inbox-read";
import { mobileInboxAccess, mobileInboxError, mobileInboxHeaders } from "@/lib/mobile/inbox";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await mobileInboxAccess(request, new URL(request.url).searchParams.get("slug") ?? "");
  if (access.status !== 200) return mobileInboxError(access.status);
  try {
    const conversations = await loadInboxRows(access.db, access.businessId);
    return Response.json({ businessId: access.businessId, conversations }, { headers: mobileInboxHeaders });
  } catch (error) {
    if (error instanceof InboxReadError) return mobileInboxError(503);
    throw error;
  }
}
