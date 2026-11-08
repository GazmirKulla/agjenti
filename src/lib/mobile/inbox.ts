import { authenticatedReadClient } from "@/lib/auth/read-client";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { instagramReplyWindow } from "@/lib/instagram/window";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import type { ThreadConversation, loadThreadMessages } from "@/lib/conversations/inbox-read";

export const mobileInboxHeaders = { "Cache-Control": "private, no-store" };

/**
 * Same identity, membership and module permission as the web Inbox.
 * Reads then use the service client with explicit business filters, like the web page.
 */
export async function mobileInboxAccess(request: Request, slug: string) {
  const identity = await authenticatedReadClient(request);
  if (!identity) return { status: 401 as const };
  const access = await requireBusinessAccess(identity.user.id, slug);
  if (!access) return { status: 403 as const };
  const allowed = await identity.db.rpc("current_user_module_allowed", {
    p_business: access.business.id,
    p_module: "inbox",
  });
  if (allowed.error) return { status: 503 as const };
  if (allowed.data !== true) return { status: 403 as const };
  return { status: 200 as const, businessId: access.business.id, db: createServiceSupabase() };
}

export function mobileInboxError(status: 401 | 403 | 404 | 503) {
  const error = status === 401 ? "Hyr përsëri në llogari." : status === 403 ? "Nuk ke qasje në Inbox." : status === 404 ? "Biseda nuk u gjet." : "Inbox-i nuk u ngarkua.";
  return Response.json({ error }, { status, headers: mobileInboxHeaders });
}

export type MobileAttachment = { kind: string; url: string; filename: string | null; caption: string | null };
function attachments(media: unknown): MobileAttachment[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item: Partial<NormalizedAttachment> & { filename?: unknown; caption?: unknown }) => {
    const url = item?.sourceUrl;
    // Only direct https media; never pass other schemes to the native client.
    if (typeof url !== "string" || !url.startsWith("https://") || url.length > 4000) return [];
    return [{
      kind: typeof item.kind === "string" ? item.kind : "document",
      url,
      filename: typeof item.filename === "string" ? item.filename : null,
      caption: typeof item.caption === "string" ? item.caption : null,
    }];
  });
}

type ThreadMessage = Awaited<ReturnType<typeof loadThreadMessages>>[number];
export function mobileThread(conversation: ThreadConversation, messages: ThreadMessage[]) {
  return {
    conversation: {
      id: conversation.id,
      name: conversation.name,
      handle: conversation.handle,
      status: conversation.status,
      channel: conversation.channel,
      replyWindow: conversation.channel === "instagram" ? instagramReplyWindow(conversation.last_inbound_at) : "standard",
    },
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction === "outbound" ? "outbound" : "inbound",
      source: m.source,
      body: m.body,
      createdAt: m.created_at,
      deliveryStatus: m.delivery_status,
      deliveryError: m.delivery_error,
      transportRequestId: m.transport_request_id ?? null,
      attachments: attachments(m.media),
    })),
  };
}
