import { isTransportId } from "@/lib/conversations/transport-access";
import { InboxReadError, loadCustomerOrders, loadThreadConversation, loadThreadPage, parseCursor } from "@/lib/conversations/inbox-read";
import { mobileInboxAccess, mobileInboxError, mobileInboxHeaders, mobileThread } from "@/lib/mobile/inbox";

export const runtime = "nodejs";
type Context = { params: Promise<{ conversationId: string }> };

/** The conversation with its latest messages; `?before=<older>` reads older ones,
 * `?limit=` a smaller page (the app polls the newest few). */
export async function GET(request: Request, context: Context) {
  const { conversationId } = await context.params;
  if (!isTransportId(conversationId)) return mobileInboxError(404);
  const url = new URL(request.url);
  const access = await mobileInboxAccess(request, url.searchParams.get("slug") ?? "");
  if (access.status !== 200) return mobileInboxError(access.status);
  try {
    const conversation = await loadThreadConversation(access.db, access.businessId, conversationId);
    if (!conversation) return mobileInboxError(404);
    const [page, orders] = await Promise.all([
      loadThreadPage(access.db, access.businessId, conversationId, {
        before: parseCursor(url.searchParams.get("before")),
        limit: Number(url.searchParams.get("limit")) || undefined,
      }),
      loadCustomerOrders(access.db, access.businessId, conversation.customer_id),
    ]);
    return Response.json(
      { businessId: access.businessId, ...mobileThread(conversation, page.messages, orders), older: page.older },
      { headers: mobileInboxHeaders },
    );
  } catch (error) {
    if (error instanceof InboxReadError) return mobileInboxError(503);
    throw error;
  }
}
