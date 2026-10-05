import { graphVersion } from "@/lib/instagram/oauth";
import { productFromCaption } from "@/lib/products/page-extract";

export type InstagramPost = {
	id: string;
	caption: string | null;
	imageUrl: string | null;
	permalink: string | null;
	mediaType: string;
};

export type InstagramProductCandidate = {
	externalId: string;
	name: string;
	description: string | null;
	price: number;
	currency: string;
	imageUrl: string | null;
	permalink: string | null;
};

const FIELD_SETS = [
	"id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
	"id,caption,media_type,media_url,permalink",
];
const PAGE_LIMIT = 25;
const MAX_PAGES = 4;
const MAX_POSTS = 100;

export function postsFromMediaPage(payload: unknown): { posts: InstagramPost[]; next: string | null } {
	if (!payload || typeof payload !== "object") return { posts: [], next: null };
	const body = payload as { data?: unknown; paging?: { next?: unknown } };
	const next = typeof body.paging?.next === "string" && safeGraphUrl(body.paging.next) ? body.paging.next : null;
	if (!Array.isArray(body.data)) return { posts: [], next };
	const posts: InstagramPost[] = [];
	for (const item of body.data) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id : "";
		if (!/^[0-9]{5,40}$/.test(id)) continue;
		const mediaType = typeof row.media_type === "string" ? row.media_type : "";
		posts.push({
			id,
			caption: typeof row.caption === "string" ? row.caption.slice(0, 8000) : null,
			imageUrl: pickImage(row, mediaType),
			permalink: typeof row.permalink === "string" ? row.permalink.slice(0, 500) : null,
			mediaType,
		});
	}
	return { posts, next };
}

export function productsFromPosts(posts: InstagramPost[]): InstagramProductCandidate[] {
	const products: InstagramProductCandidate[] = [];
	for (const post of posts) {
		const draft = productFromCaption(post.caption, post.imageUrl);
		if (!draft?.name || draft.price == null) continue;
		products.push({
			externalId: `ig:${post.id}`,
			name: draft.name,
			description: draft.description,
			price: draft.price,
			currency: draft.currency || "ALL",
			imageUrl: draft.imageUrl,
			permalink: instagramPermalink(post.permalink),
		});
	}
	return products;
}

export async function fetchInstagramMedia(
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ posts: InstagramPost[]; truncated: boolean } | { error: string }> {
	const clean = token.trim();
	if (!clean) return { error: "Lidhja e Instagram nuk lexohet. Lidhe përsëri llogarinë." };

	const posts: InstagramPost[] = [];
	let fieldIndex = 0;
	let next: string | null = mediaUrl(FIELD_SETS[0], clean);
	let pages = 0;

	while (next && pages < MAX_PAGES && posts.length < MAX_POSTS) {
		const target = safeGraphUrl(next);
		if (!target) break;
		const result = await readJson(fetchImpl, target);
		if ("error" in result) {
			if (pages === 0 && posts.length === 0 && result.retry && fieldIndex === 0) {
				fieldIndex = 1;
				next = mediaUrl(FIELD_SETS[1], clean);
				continue;
			}
			if (!posts.length) return { error: result.error };
			break;
		}
		pages += 1;
		posts.push(...result.posts);
		next = result.next;
	}

	const truncated = posts.length > MAX_POSTS || (posts.length >= MAX_POSTS && Boolean(next));
	return { posts: posts.slice(0, MAX_POSTS), truncated };
}

function mediaUrl(fields: string, token: string): string {
	const params = new URLSearchParams({
		fields,
		limit: String(PAGE_LIMIT),
		access_token: token,
	});
	return `https://graph.instagram.com/${graphVersion()}/me/media?${params}`;
}

function safeGraphUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.hostname !== "graph.instagram.com") return null;
		if (url.username || url.password) return null;
		return url;
	} catch {
		return null;
	}
}

async function readJson(
	fetchImpl: typeof fetch,
	url: URL,
): Promise<{ posts: InstagramPost[]; next: string | null } | { error: string; retry?: boolean }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 6000);
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			cache: "no-store",
			headers: { accept: "application/json" },
		});
		const body: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const code = errorCode(body);
			return { error: mediaError(code), retry: code === 100 };
		}
		return postsFromMediaPage(body);
	} catch {
		return { error: "Instagram nuk u përgjigj. Provo përsëri." };
	} finally {
		clearTimeout(timer);
	}
}

function errorCode(body: unknown): number | null {
	if (!body || typeof body !== "object" || !("error" in body)) return null;
	const code = (body as { error?: { code?: unknown } }).error?.code;
	return typeof code === "number" ? code : null;
}

function mediaError(code: number | null): string {
	if (code === 190) return "Lidhja e Instagram ka skaduar. Lidhe përsëri llogarinë.";
	if (code === 10 || code === 200) {
		return "Instagram nuk lejoi leximin e postimeve. Lidhe përsëri llogarinë.";
	}
	return "Postimet nuk u lexuan. Provo përsëri.";
}

function pickImage(row: Record<string, unknown>, mediaType: string): string | null {
	const media = typeof row.media_url === "string" ? row.media_url : "";
	const thumb = typeof row.thumbnail_url === "string" ? row.thumbnail_url : "";
	if (mediaType === "VIDEO") return thumb || null;
	if (media && !/\.(mp4|mov|m4v)(\?|$)/i.test(media)) return media;
	return thumb || null;
}

function instagramPermalink(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return null;
		if (url.hostname !== "www.instagram.com" && url.hostname !== "instagram.com") return null;
		return url.toString();
	} catch {
		return null;
	}
}
