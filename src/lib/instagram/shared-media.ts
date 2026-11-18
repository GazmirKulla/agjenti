import type { NormalizedAttachment } from "@/lib/instagram/types";

/** A post, reel or story a customer shared in a DM, from the channel's own attachment data. */
export type SharedMedia = {
	/** The channel's attachment type (ig_reel, ig_post, story_mention…). */
	type: string;
	caption: string | null;
	/** Instagram media id, when the channel sent one. */
	mediaId: string | null;
	/** Public instagram.com link of the post/reel, when the shared URL is one. */
	permalink: string | null;
	/** Instagram's embed page for that permalink. */
	embedUrl: string | null;
	/** The channel's direct media link (CDN), which expires. */
	mediaUrl: string | null;
};

const POST_PATHS = new Map([["p", "p"], ["reel", "reel"], ["reels", "reel"], ["tv", "tv"]]);

export function sharedMediaId(value: unknown): string | null {
	const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
	return /^[0-9]{5,40}$/.test(id) ? id : null;
}

/** instagram.com/{p|reel|reels|tv}/{shortcode} → canonical permalink and embed page; anything else → null. */
export function instagramPost(value: unknown): { permalink: string; embedUrl: string } | null {
	if (typeof value !== "string") return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || (url.hostname !== "www.instagram.com" && url.hostname !== "instagram.com")) return null;
	const parts = url.pathname.split("/").filter(Boolean);
	// A profile prefix (instagram.com/{user}/reel/{code}) is also a valid post link.
	const at = parts.findIndex((part) => POST_PATHS.has(part));
	const code = at >= 0 ? parts[at + 1] : undefined;
	if (!code || !/^[A-Za-z0-9_-]{5,64}$/.test(code)) return null;
	const path = `${POST_PATHS.get(parts[at])}/${code}`;
	return { permalink: `https://www.instagram.com/${path}/`, embedUrl: `https://www.instagram.com/${path}/embed/captioned/` };
}

export function sharedMediaFrom(attachment: Partial<NormalizedAttachment> | null | undefined): SharedMedia | null {
	if (!attachment || attachment.kind !== "share") return null;
	const url = typeof attachment.sourceUrl === "string" && attachment.sourceUrl.startsWith("https://") ? attachment.sourceUrl : null;
	const post = instagramPost(url);
	const caption = typeof attachment.caption === "string" && attachment.caption.trim() ? attachment.caption.trim() : null;
	return {
		type: String(attachment.metadata?.instagramAttachmentType ?? "share"),
		caption,
		mediaId: sharedMediaId(attachment.externalMediaId),
		permalink: post?.permalink ?? null,
		embedUrl: post?.embedUrl ?? null,
		mediaUrl: post ? null : url,
	};
}
