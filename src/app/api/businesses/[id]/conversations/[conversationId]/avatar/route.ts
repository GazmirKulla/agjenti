import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { PARTICIPANT_AVATAR_BUCKET } from "@/lib/conversations/participant-avatar";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The customer's stored profile photo. The URL carries a version (`?v=`) that changes only when
 * the photo is checked again, so the browser keeps it in its private cache between Inbox refreshes.
 * Browser cookie or the native app's bearer token; membership is checked on every request.
 */
export async function GET(request: Request, context: Context) {
  const { id, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return new Response(null, { status: 404 });
  const access = await transportAccess(id, request);
  if (!access) return new Response(null, { status: 403 });
  const { data, error } = await access.db.from("conversations").select("participant_avatar_path")
    .eq("business_id", id).eq("id", conversationId).maybeSingle();
  if (error) return new Response(null, { status: 503 });
  const path = data?.participant_avatar_path as string | null | undefined;
  // The path is written by the server under this business's folder; never serve another tenant's file.
  if (!path || !path.startsWith(`${id}/`)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const file = await access.db.storage.from(PARTICIPANT_AVATAR_BUCKET).download(path);
  if (file.error || !file.data) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const type = IMAGE_TYPES.has(file.data.type) ? file.data.type : "image/jpeg";
  return new Response(file.data, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
