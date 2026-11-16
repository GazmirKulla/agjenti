import { isTransportId } from "@/lib/conversations/transport-access";
import { PARTICIPANT_AVATAR_BUCKET } from "@/lib/conversations/participant-avatar";
import { verifyAvatarLink } from "@/lib/conversations/avatar-link";
import { createServiceSupabase } from "@/lib/supabase/service";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const missing = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The customer's stored profile photo. The link was signed by the server when it rendered a page the
 * viewer may see (Inbox, Customers, mobile thread), so this route makes no Auth or membership lookup:
 * a page with many photos never queues Auth calls. The link stays the same for a week, so the
 * browser keeps the image in its private cache between Inbox refreshes.
 */
export async function GET(request: Request, context: Context) {
  const { id, conversationId } = await context.params;
  if (!isTransportId(id) || !isTransportId(conversationId)) return missing(404);
  if (!verifyAvatarLink(id, conversationId, new URL(request.url).searchParams)) return missing(403);
  const db = createServiceSupabase();
  const { data, error } = await db.from("conversations").select("participant_avatar_path")
    .eq("business_id", id).eq("id", conversationId).maybeSingle();
  if (error) return missing(503);
  const path = data?.participant_avatar_path as string | null | undefined;
  // The path is written by the server under this business's folder; never serve another tenant's file.
  if (!path || !path.startsWith(`${id}/`)) return missing(404);
  const file = await db.storage.from(PARTICIPANT_AVATAR_BUCKET).download(path);
  if (file.error || !file.data) return missing(404);
  const type = IMAGE_TYPES.has(file.data.type) ? file.data.type : "image/jpeg";
  return new Response(file.data, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
