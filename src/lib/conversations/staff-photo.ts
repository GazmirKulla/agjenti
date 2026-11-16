import { createServiceSupabase } from "@/lib/supabase/service";
import { ORDER_FILES_BUCKET } from "@/lib/orders/dispatch";
import { orderPhotoToSend } from "@/lib/orders/send-photo";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Meta fetches the photo once, right after the queue picks the job up; an hour is plenty. */
const UPLOAD_LINK_SECONDS = 60 * 60;
/** Formats Instagram and WhatsApp accept as an image message (HEIC is not one). */
const SENDABLE_UPLOAD = /^(?:jpg|png|webp)$/;

/**
 * A photo staff may send in a conversation. The request names where it comes from, never a URL that is
 * sent as such; the server reads the URL from its own records at this moment.
 * - order photo (no kind, or kind "order"): the business's own photo of an item of this conversation's order;
 * - kind "upload": a photo staff uploaded for this conversation (`order-files`), sent through a short-lived link;
 * - kind "product": the photo of an active product of this business.
 * `identity` is what makes two requests the same photo (the upload link differs on every call).
 */
export type StaffPhoto = { url: string; identity: string };

export async function staffPhotoToSend(businessId: string, conversationId: string, raw: unknown): Promise<StaffPhoto | null> {
  const media = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!media) return null;
  if (media.kind === undefined || media.kind === "order") {
    const url = await orderPhotoToSend(businessId, conversationId, media);
    return url ? { url, identity: url } : null;
  }
  if (media.kind === "upload") {
    const path = typeof media.path === "string" ? media.path : "";
    const [owner, conversation, file, ...rest] = path.split("/");
    const [name, ext] = (file ?? "").split(".");
    if (rest.length || owner !== businessId || conversation !== conversationId || !uuid.test(name ?? "") || !SENDABLE_UPLOAD.test(ext ?? "")) return null;
    const { data, error } = await createServiceSupabase().storage.from(ORDER_FILES_BUCKET).createSignedUrl(path, UPLOAD_LINK_SECONDS);
    return error || !data?.signedUrl ? null : { url: data.signedUrl, identity: `upload:${path}` };
  }
  if (media.kind === "product") {
    if (typeof media.productId !== "string" || !uuid.test(media.productId)) return null;
    const { data } = await createServiceSupabase().from("products").select("image_url")
      .eq("id", media.productId).eq("business_id", businessId).eq("is_active", true).is("archived_at", null).maybeSingle();
    const url = typeof data?.image_url === "string" ? data.image_url.trim() : "";
    return /^https:\/\/\S+$/.test(url) && url.length <= 2000 ? { url, identity: `product:${media.productId}:${url}` } : null;
  }
  return null;
}
