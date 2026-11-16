import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Enough rows to cover what the Inbox shows without a full page render. */
const LIST_ROWS = 50;
const THREAD_ROWS = 40;

export class InboxVersionError extends Error {}

/**
 * A short fingerprint of what the Inbox shows: the newest conversations (order, preview, status,
 * unread, photo) and, when one is open, its newest messages (delivery, edits, unsends). The Inbox
 * re-renders only when this changes, so routine polling costs two indexed reads instead of a
 * whole page with its layout.
 */
export async function loadInboxVersion(db: SupabaseClient, businessId: string, conversationId: string | null): Promise<string> {
  const [list, thread] = await Promise.all([
    db.from("conversations")
      .select("id,status,last_message_at,last_message_preview,unread_count,participant_display_name,participant_avatar_checked_at")
      .eq("business_id", businessId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(LIST_ROWS),
    conversationId
      ? db.from("messages")
        .select("id,delivery_status,customer_edited_at,customer_deleted_at")
        .eq("business_id", businessId).eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(THREAD_ROWS)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (list.error || thread.error) throw new InboxVersionError("version_unavailable");
  return createHash("sha256").update(JSON.stringify([list.data, thread.data])).digest("base64url").slice(0, 22);
}
