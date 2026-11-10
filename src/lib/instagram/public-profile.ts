import { graphVersion } from "./oauth";
import { cleanBusinessProfile, type InstagramBusinessProfile } from "./business-profile";
import type { InstagramPost } from "./media";

/** Reading a public Instagram Business/Creator account by username, through
 * Meta's Business Discovery on Agjenti.app's own Instagram account (Facebook
 * Login). Off until both values are configured. */
export function publicScanAvailable() {
  return Boolean(process.env.META_DISCOVERY_TOKEN && process.env.META_DISCOVERY_IG_USER_ID);
}

/** "@shop.al", "instagram.com/shop.al/", "https://www.instagram.com/shop.al?igsh=…" → "shop.al". */
export function normalizeInstagramUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text) return null;
  const fromUrl = text.match(/instagram\.com\/([^/?#\s]+)/i);
  if (fromUrl) text = fromUrl[1];
  text = text.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
  return /^(?!.*\.\.)(?!\.)[a-z0-9._]{1,30}(?<!\.)$/.test(text) ? text : null;
}

export class PublicInstagramError extends Error {
  constructor(message: string, readonly reason: "unavailable" | "not_found" | "failed") { super(message); }
}

type DiscoveryMedia = { id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string;
  children?: { data?: { id: string; media_type?: string; media_url?: string }[] } };
type DiscoveryResponse = { business_discovery?: Record<string, unknown> & { media?: { data?: DiscoveryMedia[] } }; error?: { code?: number; message?: string } };

/** Profile and recent posts of a public Business or Creator account. */
export async function fetchPublicInstagram(username: string, fetcher: typeof fetch = fetch): Promise<{ profile: InstagramBusinessProfile; posts: InstagramPost[] }> {
  const token = process.env.META_DISCOVERY_TOKEN, account = process.env.META_DISCOVERY_IG_USER_ID;
  if (!token || !account) throw new PublicInstagramError("Leximi i Instagram-it me username nuk është aktivizuar ende.", "unavailable");
  const fields = `business_discovery.username(${username}){username,name,biography,website,profile_picture_url,media.limit(50){id,caption,media_type,media_url,thumbnail_url,permalink,children{id,media_type,media_url}}}`;
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(account)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({})) as DiscoveryResponse;
  const found = data.business_discovery;
  if (!response.ok || !found) {
    // Meta answers 400 for unknown, personal, private or age-gated accounts.
    if (response.status === 400 || data.error?.code === 110 || data.error?.code === 100)
      throw new PublicInstagramError("Kjo llogari nuk u gjet ose nuk është llogari biznesi publike.", "not_found");
    throw new PublicInstagramError("Instagram nuk u lexua. Provo përsëri më vonë.", "failed");
  }
  const posts: InstagramPost[] = (found.media?.data ?? []).map((m) => {
    const children = (m.children?.data ?? []).filter((c) => c.media_url && c.media_type !== "VIDEO").map((c) => ({ id: c.id, url: c.media_url! }));
    return {
      id: m.id, caption: m.caption ?? null, permalink: m.permalink ?? null, mediaType: m.media_type ?? "IMAGE",
      imageUrl: m.media_type === "VIDEO" ? m.thumbnail_url ?? null : m.media_url ?? m.thumbnail_url ?? null,
      ...(children.length ? { images: children } : {}),
    };
  });
  return { profile: cleanBusinessProfile(found), posts };
}
