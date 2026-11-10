import { after } from "next/server";
import { enqueueDiscovery } from "./queue";
import { continueDiscovery, workerOrigin } from "./continue";
import { saveInstagramUsername } from "./instagram-username";

/** "zana.al", "www.zana.al/", "https://zana.al" → an http(s) address, or null. */
export function normalizeWebsite(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** Where the agent first learns about a new business: its public Instagram
 * (by username) and its website. Both are optional; a failure never blocks
 * creating the business, and both can be added later from Knowledge. */
export async function startOnboardingSources(businessId: string, userId: string, sources: { instagramUsername?: string | null; website?: string | null }) {
  const instagram = sources.instagramUsername
    ? await saveInstagramUsername(businessId, userId, sources.instagramUsername).catch(() => null) : null;
  const website = sources.website
    ? await enqueueDiscovery(businessId, userId, "website", sources.website, false, { review: true, pages: 1 }).catch(() => null) : null;
  // Start working right away; nobody needs to keep a page open.
  if ((instagram && "scanning" in instagram && instagram.scanning) || website) {
    const origin = workerOrigin();
    after(() => continueDiscovery(businessId, origin));
  }
}
