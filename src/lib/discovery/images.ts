import type { InstagramPost } from "@/lib/instagram/media";

export type DiscoveryImage = { id: string; url: string; caption: string; postUrl: string | null };
export const MAX_DISCOVERY_IMAGES = 25;
export const IMAGE_BATCH_SIZE = 5;

export function selectDiscoveryImages(posts: readonly InstagramPost[]): DiscoveryImage[] {
  const result: DiscoveryImage[] = [];
  const seen = new Set<string>();
  // Recent posts plus a spread across the remaining history. Take one image
  // per post first, so a single carousel cannot consume the entire budget.
  const recent = posts.slice(0, 8);
  const rest = posts.slice(8);
  const sampled = rest.filter((_, i) => i % Math.max(1, Math.floor(rest.length / 17)) === 0);
  const selected = [...recent, ...sampled, ...rest];
  for (let index = 0; index < 10 && result.length < MAX_DISCOVERY_IMAGES; index++) {
    for (const post of selected) {
      const images = post.images?.length ? post.images : post.imageUrl ? [{ id: post.id, url: post.imageUrl }] : [];
      const image = images[index];
      if (!image || seen.has(image.url)) continue;
      try {
        const url = new URL(image.url);
        // These are server-fetched media URLs, never client-supplied URLs.
        if (url.protocol !== "https:" || url.username || url.password) continue;
        seen.add(image.url);
        result.push({ ...image, caption: post.caption ?? "", postUrl: post.permalink });
        if (result.length === MAX_DISCOVERY_IMAGES) break;
      } catch { /* Ignore malformed media. */ }
    }
  }
  return result;
}
