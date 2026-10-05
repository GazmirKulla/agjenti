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
		const result = await fetchGraph(fetchImpl, target);
		if ("error" in result) {
			if (pages === 0 && posts.length === 0 && result.retry && fieldIndex === 0) {
				fieldIndex = 1;
				next = mediaUrl(FIELD_SETS[1], clean);
				continue;
			}
			if (!posts.length) return { error: result.error };
			break;
		}
		const page = postsFromMediaPage(result.body);
		pages += 1;
		posts.push(...page.posts);
		next = page.next;
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

const GRAPH_HOSTS = new Set(["graph.instagram.com", "graph.facebook.com"]);

function safeGraphUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !GRAPH_HOSTS.has(url.hostname)) return null;
		if (url.username || url.password) return null;
		return url;
	} catch {
		return null;
	}
}

async function fetchGraph(
	fetchImpl: typeof fetch,
	url: URL,
): Promise<{ body: unknown } | { error: string; code: number | null; retry: boolean }> {
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
			return { error: mediaError(code), code, retry: code === 100 };
		}
		return { body };
	} catch {
		return { error: "Instagram nuk u përgjigj. Provo përsëri.", code: null, retry: false };
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

const DISCOVERY_FIELDS = [
	"id,caption,media_type,media_url,permalink,thumbnail_url,timestamp",
	"id,caption,media_type,media_url,permalink,timestamp",
];
const DISCOVERY_HOSTS = ["graph.instagram.com", "graph.facebook.com"] as const;

export function parseInstagramUsername(raw: string): string | null {
	const text = raw.trim();
	if (!text) return null;
	let candidate = text.replace(/^@+/, "");
	if (/^https?:\/\//i.test(candidate)) {
		try {
			const url = new URL(candidate);
			const host = url.hostname.replace(/^www\./, "").toLowerCase();
			if (host !== "instagram.com") return null;
			const parts = url.pathname.split("/").filter(Boolean);
			if (!parts.length) return null;
			if (["p", "reel", "reels", "stories", "explore", "tv"].includes(parts[0].toLowerCase())) return null;
			candidate = decodeURIComponent(parts[0]);
		} catch {
			return null;
		}
	}
	candidate = candidate.replace(/\/+$/, "");
	if (!/^[A-Za-z0-9._]{1,30}$/.test(candidate)) return null;
	if (candidate.startsWith(".") || candidate.endsWith(".") || candidate.includes("..")) return null;
	return candidate;
}

export function postsFromDiscovery(payload: unknown): { posts: InstagramPost[]; next: string | null; after: string | null } {
	if (!payload || typeof payload !== "object") return { posts: [], next: null, after: null };
	const discovery = (payload as { business_discovery?: unknown }).business_discovery;
	if (!discovery || typeof discovery !== "object") return { posts: [], next: null, after: null };
	const media = (discovery as { media?: unknown }).media;
	const page = postsFromMediaPage(media);
	const afterRaw =
		media && typeof media === "object"
			? (media as { paging?: { cursors?: { after?: unknown } } }).paging?.cursors?.after
			: null;
	const after = typeof afterRaw === "string" && safeCursor(afterRaw) ? afterRaw : null;
	return { posts: page.posts, next: page.next, after };
}

export async function fetchPublicInstagramMedia(
	token: string,
	igUserId: string,
	username: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ posts: InstagramPost[]; truncated: boolean } | { error: string }> {
	const clean = token.trim();
	const id = igUserId.trim();
	const handle = parseInstagramUsername(username);
	if (!clean) return { error: "Lidhja e Instagram nuk lexohet. Lidhe përsëri llogarinë." };
	if (!/^[0-9]{5,40}$/.test(id)) {
		return { error: "Lidhja e Instagram nuk është e plotë. Lidhe përsëri llogarinë." };
	}
	if (!handle) return { error: "Shkruaj një llogari publike, p.sh. @dyqani ose linkun e profilit." };

	let lastError = "Postimet e kësaj llogarie nuk u lexuan. Provo përsëri.";
	for (const host of DISCOVERY_HOSTS) {
		const result = await readDiscovery(fetchImpl, clean, id, handle, host);
		if (!("error" in result)) return result;
		lastError = result.error;
		if (!result.tryOtherHost) return { error: result.error };
	}
	return { error: lastError };
}

async function readDiscovery(
	fetchImpl: typeof fetch,
	token: string,
	igUserId: string,
	username: string,
	host: (typeof DISCOVERY_HOSTS)[number],
): Promise<{ posts: InstagramPost[]; truncated: boolean } | { error: string; tryOtherHost: boolean }> {
	const posts: InstagramPost[] = [];
	let fieldIndex = 0;
	let nextUrl: string | null = discoveryUrl(host, igUserId, username, DISCOVERY_FIELDS[0], token, null);
	let pages = 0;

	while (nextUrl && pages < MAX_PAGES && posts.length < MAX_POSTS) {
		const target = safeGraphUrl(nextUrl);
		if (!target || target.hostname !== host) break;
		const result = await fetchGraph(fetchImpl, target);
		if ("error" in result) {
			if (pages === 0 && posts.length === 0 && result.retry && fieldIndex === 0) {
				fieldIndex = 1;
				nextUrl = discoveryUrl(host, igUserId, username, DISCOVERY_FIELDS[1], token, null);
				continue;
			}
			if (!posts.length) {
				return {
					error: discoveryError(result.code),
					tryOtherHost: result.code === 10 || result.code === 100 || result.code === 200,
				};
			}
			break;
		}
		const parsed = postsFromDiscovery(result.body);
		if (pages === 0 && parsed.posts.length === 0 && !parsed.after && !parsed.next) {
			const missing = !result.body || typeof result.body !== "object" || !("business_discovery" in result.body);
			if (missing) {
				return {
					error: "Kjo llogari nuk u gjet, ose nuk është profesionale dhe publike.",
					tryOtherHost: false,
				};
			}
		}
		pages += 1;
		posts.push(...parsed.posts);
		if (parsed.next && safeGraphUrl(parsed.next)?.hostname === host) nextUrl = parsed.next;
		else if (parsed.after) nextUrl = discoveryUrl(host, igUserId, username, DISCOVERY_FIELDS[fieldIndex], token, parsed.after);
		else nextUrl = null;
	}

	const truncated = posts.length > MAX_POSTS || (posts.length >= MAX_POSTS && Boolean(nextUrl));
	return { posts: posts.slice(0, MAX_POSTS), truncated };
}

function discoveryUrl(
	host: string,
	igUserId: string,
	username: string,
	mediaFields: string,
	token: string,
	after: string | null,
): string {
	const media = after
		? `media.limit(${PAGE_LIMIT}).after(${after}){${mediaFields}}`
		: `media.limit(${PAGE_LIMIT}){${mediaFields}}`;
	const params = new URLSearchParams({
		fields: `business_discovery.username(${username}){${media}}`,
		access_token: token,
	});
	return `https://${host}/${graphVersion()}/${igUserId}?${params}`;
}

function safeCursor(value: string): boolean {
	return value.length > 0 && value.length <= 500 && /^[A-Za-z0-9_\-+/=]+$/.test(value);
}

function discoveryError(code: number | null): string {
	if (code === 190) return "Lidhja e Instagram ka skaduar. Lidhe përsëri llogarinë.";
	if (code === 110) return "Kjo llogari nuk u gjet, ose nuk është profesionale dhe publike.";
	if (code === 10 || code === 100 || code === 200) {
		return "Instagram nuk lejoi leximin e kësaj llogarie. Duhet të jetë profesionale, publike, dhe aplikacioni të ketë lejen për ta kërkuar.";
	}
	return "Postimet e kësaj llogarie nuk u lexuan. Provo përsëri.";
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
