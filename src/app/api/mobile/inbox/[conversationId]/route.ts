import { isTransportId } from "@/lib/conversations/transport-access";
import { InboxReadError, loadThreadConversation, loadThreadMessages } from "@/lib/conversations/inbox-read";
import { mobileInboxAccess, mobileInboxError, mobileInboxHeaders, mobileThread } from "@/lib/mobile/inbox";

export const runtime = "nodejs";
type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, context: Context) {
  const { conversationId } = await context.params;
  if (!isTransportId(conversationId)) return mobileInboxError(404);
  const access = await mobileInboxAccess(request, new URL(request.url).searchParams.get("slug") ?? "");
  if (access.status !== 200) return mobileInboxError(access.status);
  try {
    const conversation = await loadThreadConversation(access.db, access.businessId, conversationId);
    if (!conversation) return mobileInboxError(404);
    const messages = await loadThreadMessages(access.db, access.businessId, conversationId);
    return Response.json({ businessId: access.businessId, ...mobileThread(conversation, messages) }, { headers: mobileInboxHeaders });
  } catch (error) {
    if (error instanceof InboxReadError) return mobileInboxError(503);
    throw error;
  }
}
