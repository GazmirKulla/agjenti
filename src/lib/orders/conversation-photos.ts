import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { whatsappGraphVersion } from "@/lib/whatsapp/api";

export const MAX_ORDER_PHOTO_BYTES = 10 * 1024 * 1024;
export const ORDER_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};
/** Customer media is only ever fetched from Meta's own hosts, never from an arbitrary stored URL. */
const META_HOSTS = ["cdninstagram.com", "fbcdn.net", "fbsbx.com"];
const PHOTO_ID = /^([0-9a-f-]{36}):(\d{1,2})$/i;
const LIST_MESSAGES = 60;
const LIST_PHOTOS = 24;

export type ConversationPhoto = { id: string; createdAt: string; caption: string | null; /** Sent by the business, not the customer. */ byBusiness?: boolean };
export type PhotoRead = { bytes: Buffer; type: string } | { error: string; status: number };

type Attachment = { kind?: unknown; sourceUrl?: unknown; externalMediaId?: unknown; caption?: unknown };

export function isMetaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && META_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function photoSource(item: unknown): { url: string } | { mediaId: string } | null {
  const a = (item && typeof item === "object" ? item : {}) as Attachment;
  if (a.kind !== "image") return null;
  if (typeof a.sourceUrl === "string" && isMetaUrl(a.sourceUrl)) return { url: a.sourceUrl };
  if (typeof a.externalMediaId === "string" && /^\d{1,40}$/.test(a.externalMediaId)) return { mediaId: a.externalMediaId };
  return null;
}

/** Photos the customer sent in this conversation, newest first; with `business`, also those the business sent
 * (a processed design shown to the customer). Only ids are returned; the bytes go through readCustomerPhoto. */
export async function listCustomerPhotos(db: SupabaseClient, businessId: string, conversationId: string, options: { business?: boolean } = {}): Promise<ConversationPhoto[] | null> {
  const { data, error } = await db.from("messages").select("id,media,created_at,direction").eq("business_id", businessId)
    .eq("conversation_id", conversationId).in("direction", options.business ? ["inbound", "outbound"] : ["inbound"]).order("created_at", { ascending: false }).limit(LIST_MESSAGES);
  if (error) return null;
  return (data ?? []).flatMap((m) => (Array.isArray(m.media) ? m.media : []).flatMap((item: unknown, index: number) => {
    if (!photoSource(item)) return [];
    const caption = (item as Attachment).caption;
    return [{ id: `${m.id}:${index}`, createdAt: m.created_at as string, caption: typeof caption === "string" ? caption.slice(0, 200) : null,
      ...(m.direction === "outbound" ? { byBusiness: true } : {}) }];
  })).slice(0, LIST_PHOTOS);
}

async function readCapped(response: Response): Promise<Buffer | null> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ORDER_PHOTO_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ORDER_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return total ? Buffer.concat(chunks) : null;
}

const GONE = "Kjo foto nuk merret më nga biseda (lidhja e kanalit ka skaduar). Ngarkoje vetë.";

async function download(url: string, token?: string, declaredType?: string): Promise<PhotoRead> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  }).catch(() => null);
  if (!response) return { error: "Fotoja nuk u lexua nga kanali. Provo përsëri.", status: 502 };
  // An expired CDN link answers 403/404/410.
  if (!response.ok) return response.status >= 500 ? { error: "Fotoja nuk u lexua nga kanali. Provo përsëri.", status: 502 } : { error: GONE, status: 410 };
  const type = (response.headers.get("content-type") ?? declaredType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ORDER_PHOTO_TYPES[type]) return { error: "Kjo bashkëngjitje nuk është foto JPG, PNG, WEBP ose HEIC.", status: 415 };
  const bytes = await readCapped(response).catch(() => null);
  if (!bytes) return { error: "Fotoja duhet të jetë deri në 10 MB.", status: 413 };
  return { bytes, type };
}

/** WhatsApp keeps only a media id: the connection's token reads its short-lived link, then the bytes. */
async function downloadWhatsApp(businessId: string, conversationId: string, mediaId: string): Promise<PhotoRead> {
  const db = createServiceSupabase();
  const { data: conversation } = await db.from("conversations").select("whatsapp_connection_id")
    .eq("id", conversationId).eq("business_id", businessId).maybeSingle();
  if (!conversation?.whatsapp_connection_id) return { error: GONE, status: 410 };
  const { data: connection } = await db.from("whatsapp_connections").select("access_token_ciphertext,status")
    .eq("id", conversation.whatsapp_connection_id).eq("business_id", businessId).maybeSingle();
  if (!connection?.access_token_ciphertext || connection.status !== "connected")
    return { error: "WhatsApp nuk është i lidhur. Ngarkoje foton vetë.", status: 409 };
  const token = decryptSecret(connection.access_token_ciphertext);
  const meta = await fetch(`https://graph.facebook.com/${whatsappGraphVersion()}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), cache: "no-store",
  }).then((r) => (r.ok ? r.json() : null), () => null) as { url?: unknown; mime_type?: unknown } | null;
  if (!meta || typeof meta.url !== "string" || !isMetaUrl(meta.url)) return { error: GONE, status: 410 };
  return download(meta.url, token, typeof meta.mime_type === "string" ? meta.mime_type : undefined);
}

/** The bytes of one photo of this conversation, the customer's or the business's (an id from listCustomerPhotos). */
export async function readCustomerPhoto(db: SupabaseClient, businessId: string, conversationId: string, photoId: string): Promise<PhotoRead> {
  const match = PHOTO_ID.exec(photoId);
  if (!match) return { error: "Fotoja nuk u gjet në bisedë.", status: 404 };
  const { data: message, error } = await db.from("messages").select("media,direction").eq("id", match[1]!)
    .eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle();
  if (error) return { error: "Biseda nuk u lexua.", status: 503 };
  const source = (message?.direction === "inbound" || message?.direction === "outbound") && Array.isArray(message.media) ? photoSource(message.media[Number(match[2])]) : null;
  if (!source) return { error: "Fotoja nuk u gjet në bisedë.", status: 404 };
  return "url" in source ? download(source.url) : downloadWhatsApp(businessId, conversationId, source.mediaId);
}
