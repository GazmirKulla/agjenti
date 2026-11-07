import { authenticatedReadClient } from "@/lib/auth/read-client";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { conversationDisplayName } from "@/lib/conversations/ensure-customer";

export class RecentInboxError extends Error {
  constructor(public status: number) {
    super("Inbox unavailable");
  }
}

export type RecentInboxConversation = {
  id: string;
  name: string;
  preview: string | null;
  unread: number;
  channel: "instagram" | "whatsapp";
  updatedAt: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CustomerJoin = {
  business_id: string;
  display_name: string | null;
  username: string | null;
} | null;

export async function loadRecentInbox(slug: string, request: Request) {
  const identity = await authenticatedReadClient(request);
  if (!identity) throw new RecentInboxError(401);
  const access = await requireBusinessAccess(identity.user.id, slug);
  if (!access) throw new RecentInboxError(403);
  const allowed = await identity.db.rpc("current_user_module_allowed", {
    p_business: access.business.id,
    p_module: "inbox",
  });
  if (allowed.error || allowed.data !== true) return { conversations: [] as RecentInboxConversation[] };
  const { data, error } = await identity.db
    .from("conversations")
    .select(
      "id,channel,last_message_preview,last_message_at,unread_count,participant_display_name,participant_username,customers(business_id,display_name,username)",
    )
    .eq("business_id", access.business.id)
    .order("last_message_at", { ascending: false })
    .limit(3);
  if (error) throw new RecentInboxError(503);
  const conversations = (data ?? []).flatMap((row) => {
    if (typeof row.id !== "string" || !UUID.test(row.id)) return [];
    const joined = row.customers as unknown as CustomerJoin;
    const customer =
      joined?.business_id === access.business.id ? joined : null;
    const channel =
      row.channel === "whatsapp" ? "whatsapp" : row.channel === "instagram" ? "instagram" : null;
    if (!channel) return [];
    const preview =
      typeof row.last_message_preview === "string"
        ? row.last_message_preview.slice(0, 140)
        : null;
    const unread =
      Number.isSafeInteger(row.unread_count) && (row.unread_count as number) > 0
        ? (row.unread_count as number)
        : 0;
    return [
      {
        id: row.id,
        name: conversationDisplayName({
          participant_display_name: row.participant_display_name,
          participant_username: row.participant_username,
          customers: customer,
        }),
        preview,
        unread,
        channel,
        updatedAt:
          typeof row.last_message_at === "string" ? row.last_message_at : null,
      } satisfies RecentInboxConversation,
    ];
  });
  return { conversations };
}
