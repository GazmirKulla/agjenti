import { createServiceSupabase } from "@/lib/supabase/service";
import { defaultCommunicationPolicy, parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { splitInstagramText } from "@/lib/instagram/split-text";
import type { SendInstagramResult } from "@/lib/instagram/send";
import type { PartObserver } from "./delivery-status";
import { channelAdapter, type MessagingChannel } from "./channel";

/** At most this many product photos follow one reply. */
export const MAX_REPLY_PHOTOS = 3;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sendableUrl = (value: unknown): value is string => typeof value === "string" && /^https:\/\/\S+$/.test(value.trim()) && value.trim().length <= 2000;

export type ReplyProductPhoto = { productId: string; url: string };

/**
 * The photos of the products a reply presented through catalog slots, in the reply's order: only active
 * products of this business with a stored https photo, not already sent in this conversation, at most
 * MAX_REPLY_PHOTOS. The business can turn this off in the agent's communication settings. This is a
 * proposal: the queue re-reads every photo from the products table before anything is sent.
 */
export async function replyProductPhotos(input: {
  businessId: string; productIds: readonly string[]; communication?: unknown; conversationId?: string | null;
}): Promise<ReplyProductPhoto[]> {
  const policy = input.communication ? parseCommunicationPolicy(input.communication) : defaultCommunicationPolicy;
  const ids = [...new Set(input.productIds)].filter(id => uuid.test(id));
  if (policy.productPhotos !== "send" || !ids.length) return [];
  const db = createServiceSupabase();
  const [products, sent] = await Promise.all([
    db.from("products").select("id,image_url").eq("business_id", input.businessId).in("id", ids).eq("is_active", true).is("archived_at", null),
    input.conversationId
      ? db.from("messages").select("media").eq("business_id", input.businessId).eq("conversation_id", input.conversationId)
        .eq("direction", "outbound").not("media", "is", null).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as { media: unknown }[], error: null }),
  ]);
  // Photos only add to a reply whose text already names the products and prices; without a confirmed
  // read the reply goes as text.
  if (products.error || sent.error) return [];
  const already = new Set((sent.data ?? []).flatMap(row => Array.isArray(row.media) ? row.media : [])
    .map(item => item && typeof item === "object" ? (item as { sourceUrl?: unknown }).sourceUrl : null)
    .filter((url): url is string => typeof url === "string"));
  const photos: ReplyProductPhoto[] = [];
  for (const id of ids) {
    const url = (products.data ?? []).find(row => row.id === id)?.image_url;
    if (!sendableUrl(url) || already.has(url.trim()) || photos.some(photo => photo.url === url.trim())) continue;
    photos.push({ productId: id, url: url.trim() });
    if (photos.length === MAX_REPLY_PHOTOS) break;
  }
  return photos;
}

/**
 * One agent reply as one transport job: the text, then each photo, numbered as parts of the same total.
 * Every part is recorded before the next request and nothing is replayed. A photo the channel rejects is
 * a failed part (the message shows it) and the delivered text stands; an unknown result stops the send as
 * uncertain.
 */
export async function sendReplyWithPhotos(params: {
  channel: MessagingChannel; accountId: string; token: string; to: string; body: string;
  photos: readonly { url: string }[]; onPart?: PartObserver;
}): Promise<SendInstagramResult> {
  const adapter = channelAdapter(params.channel);
  const body = params.body.trim();
  const textParts = params.channel === "whatsapp" ? 1 : splitInstagramText(body).length;
  const total = textParts + params.photos.length;
  const target = { accountId: params.accountId, token: params.token, to: params.to };
  const at = (offset: number): PartObserver | undefined => params.onPart
    ? (part) => params.onPart!({ ...part, index: part.index + offset }, total) : undefined;
  const text = await adapter.send({ ...target, body, onPart: at(0) });
  if (!text.ok) return text;
  let messageId = text.messageId;
  for (const [index, photo] of params.photos.entries()) {
    const sent = await adapter.sendImage({ ...target, url: photo.url, onPart: at(textParts + index) });
    if (sent.ok) { messageId = sent.messageId ?? messageId; continue; }
    // A rejected photo stays recorded as a failed part; the other photos still go.
    if (sent.parts?.some(part => part.status === "uncertain") ?? true) return sent;
  }
  return { ok: true, messageId };
}
