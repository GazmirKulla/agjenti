import { graphVersion } from "./oauth";
import { cleanBusinessProfile, type InstagramBusinessProfile } from "./business-profile";
import type { InstagramPost } from "./media";

/** How many recent posts a scan by username reads. */
export const PUBLIC_POST_LIMIT = 5;

/** Reading a public Instagram account by username. Meta's Business Discovery
 * (on Agjenti.app's own account, Facebook Login) is preferred once configured;
 * until then Apify's Instagram scraper reads the public profile. Off when
 * neither is configured. */
export function publicScanProvider(): "meta" | "apify" | null {
  if (process.env.META_DISCOVERY_TOKEN && process.env.META_DISCOVERY_IG_USER_ID) return "meta";
  if (process.env.APIFY_TOKEN) return "apify";
  return null;
}
export function publicScanAvailable() {
  return publicScanProvider() !== null;
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

/** Followers and posts, shown so the owner can recognise their own account. */
export type PublicStats = { followers?: number; posts?: number };
type PublicInstagram = { profile: InstagramBusinessProfile; posts: InstagramPost[]; stats?: PublicStats };

/** Profile and the last PUBLIC_POST_LIMIT posts of a public account. */
export async function fetchPublicInstagram(username: string, fetcher: typeof fetch = fetch): Promise<PublicInstagram> {
  const provider = publicScanProvider();
  if (provider === "apify") return fetchWithApify(username, fetcher);
  if (provider === null) throw new PublicInstagramError("Leximi i Instagram-it me username nuk është aktivizuar ende.", "unavailable");
  return fetchWithMeta(username, fetcher);
}

async function fetchWithMeta(username: string, fetcher: typeof fetch): Promise<PublicInstagram> {
  const token = process.env.META_DISCOVERY_TOKEN, account = process.env.META_DISCOVERY_IG_USER_ID;
  if (!token || !account) throw new PublicInstagramError("Leximi i Instagram-it me username nuk është aktivizuar ende.", "unavailable");
  const fields = `business_discovery.username(${username}){username,name,biography,website,profile_picture_url,followers_count,media_count,media.limit(${PUBLIC_POST_LIMIT}){id,caption,media_type,media_url,thumbnail_url,permalink,children{id,media_type,media_url}}}`;
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
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return { profile: cleanBusinessProfile(found), posts, stats: { followers: count(found.followers_count), posts: count(found.media_count) } };
}

type ApifyPost = { id?: string; type?: string; caption?: string; url?: string; displayUrl?: string; images?: string[];
  childPosts?: { id?: string; type?: string; displayUrl?: string }[] };
type ApifyProfile = { username?: string; fullName?: string; biography?: string; externalUrl?: string; profilePicUrl?: string;
  private?: boolean; error?: string; latestPosts?: ApifyPost[]; followersCount?: number; postsCount?: number };

/** One "details" result of apify/instagram-scraper: the profile with its latest
 * posts, billed as a single result. */
async function fetchWithApify(username: string, fetcher: typeof fetch): Promise<PublicInstagram> {
  const url = new URL("https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items");
  url.searchParams.set("timeout", "150");
  url.searchParams.set("clean", "true");
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(160000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.APIFY_TOKEN}` },
      body: JSON.stringify({ directUrls: [`https://www.instagram.com/${username}/`], resultsType: "details", resultsLimit: 1, addParentData: false }),
    });
  } catch { throw new PublicInstagramError("Instagram nuk u lexua. Provo përsëri më vonë.", "failed"); }
  const items = await response.json().catch(() => null) as ApifyProfile[] | null;
  if (!response.ok || !Array.isArray(items)) throw new PublicInstagramError("Instagram nuk u lexua. Provo përsëri më vonë.", "failed");
  const found = items.find((item) => item && !item.error && item.username?.toLowerCase() === username);
  if (!found || found.private) throw new PublicInstagramError("Kjo llogari nuk u gjet ose nuk është publike.", "not_found");
  const posts: InstagramPost[] = (found.latestPosts ?? []).slice(0, PUBLIC_POST_LIMIT).map((p, index) => {
    const children = (p.childPosts ?? []).filter((c) => c.displayUrl && c.type !== "Video").map((c, i) => ({ id: c.id ?? `${p.id ?? index}-${i}`, url: c.displayUrl! }));
    return {
      id: p.id ?? String(index), caption: p.caption ?? null, permalink: p.url ?? null,
      mediaType: p.type === "Video" ? "VIDEO" : p.type === "Sidecar" ? "CAROUSEL_ALBUM" : "IMAGE",
      imageUrl: p.displayUrl ?? null,
      ...(children.length ? { images: children } : {}),
    };
  });
  const profile = cleanBusinessProfile({ username: found.username, name: found.fullName, biography: found.biography,
    website: found.externalUrl, profile_picture_url: found.profilePicUrl });
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return { profile, posts, stats: { followers: count(found.followersCount), posts: count(found.postsCount) } };
}
