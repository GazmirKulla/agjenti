import { describe, expect, it, vi } from "vitest";
import { findOwnInstagramPosts } from "@/lib/instagram/media";
import { parseInstagramWebhookPayload } from "@/lib/instagram/parse-webhook";
import { instagramPost, sharedMediaFrom } from "@/lib/instagram/shared-media";

function sharedReel(payload: Record<string, unknown>, type = "ig_reel") {
	return parseInstagramWebhookPayload({
		object: "instagram",
		entry: [{ id: "17841400008460056", time: 1, messaging: [{
			sender: { id: "1089304595302911" }, recipient: { id: "17841400008460056" }, timestamp: 1758290699000,
			message: { mid: "bWlkX3NoYXJlZF9yZWVs", attachments: [{ type, payload }] },
		}] }],
	} as never).messages[0];
}

describe("instagramPost", () => {
	it("reads post, reel and profile-prefixed links into a canonical permalink and embed page", () => {
		expect(instagramPost("https://www.instagram.com/reel/DYPUKXnM7Vk/?igsh=abc")).toEqual({
			permalink: "https://www.instagram.com/reel/DYPUKXnM7Vk/",
			embedUrl: "https://www.instagram.com/reel/DYPUKXnM7Vk/embed/captioned/",
		});
		expect(instagramPost("https://instagram.com/reels/DYPUKXnM7Vk")?.permalink).toBe("https://www.instagram.com/reel/DYPUKXnM7Vk/");
		expect(instagramPost("https://www.instagram.com/zana.store/p/C1a2b3c4d5/")?.permalink).toBe("https://www.instagram.com/p/C1a2b3c4d5/");
	});
	it("refuses other hosts, plain http, profiles and malformed codes", () => {
		expect(instagramPost("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBeNull();
		expect(instagramPost("http://www.instagram.com/reel/DYPUKXnM7Vk/")).toBeNull();
		expect(instagramPost("https://www.instagram.com/zana.store/")).toBeNull();
		expect(instagramPost("https://www.instagram.com/reel/<script>/")).toBeNull();
		expect(instagramPost("https://evil.example/www.instagram.com/reel/DYPUKXnM7Vk/")).toBeNull();
	});
});

describe("shared reels and posts from the webhook", () => {
	it("keeps the caption and media id the channel sends with a shared reel", () => {
		const message = sharedReel({ url: "https://www.instagram.com/reel/DYPUKXnM7Vk/", title: "Fustan liri, 3 ngjyra", reel_video_id: "18034567890123456" });
		expect(message.attachments[0]).toMatchObject({ kind: "share", caption: "Fustan liri, 3 ngjyra", externalMediaId: "18034567890123456" });
		expect(sharedMediaFrom(message.attachments[0])).toEqual({
			type: "ig_reel", caption: "Fustan liri, 3 ngjyra", mediaId: "18034567890123456",
			permalink: "https://www.instagram.com/reel/DYPUKXnM7Vk/", embedUrl: "https://www.instagram.com/reel/DYPUKXnM7Vk/embed/captioned/", mediaUrl: null,
		});
	});
	it("reads a post media id, and drops ids that are not numeric", () => {
		expect(sharedReel({ url: "https://lookaside.fbsbx.com/x", ig_post_media_id: "18012345678901234" }, "ig_post").attachments[0].externalMediaId).toBe("18012345678901234");
		expect(sharedReel({ url: "https://lookaside.fbsbx.com/x", reel_video_id: "../1" }).attachments[0].externalMediaId).toBeNull();
	});
	it("a CDN link stays a direct media preview; non-share attachments are not shared media", () => {
		const message = sharedReel({ url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }, "ig_post");
		expect(sharedMediaFrom(message.attachments[0])).toMatchObject({ permalink: null, embedUrl: null, mediaUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", caption: null });
		expect(sharedMediaFrom({ kind: "image", sourceUrl: "https://lookaside.fbsbx.com/x" })).toBeNull();
	});
});

describe("findOwnInstagramPosts", () => {
	const page = (posts: { id: string; caption: string | null; permalink: string }[], next: string | null = null) =>
		new Response(JSON.stringify({ data: posts, paging: next ? { next } : {} }), { status: 200 });
	it("finds the business's own reel by its link and stops once everything is found", async () => {
		const fetchImpl = vi.fn(async () => page([
			{ id: "18000000000000001", caption: "Tjetër", permalink: "https://www.instagram.com/p/AAAAAAA/" },
			{ id: "18034567890123456", caption: "Puzzle i Personalizuar Prej Druri", permalink: "https://www.instagram.com/reel/DYPUKXnM7Vk/" },
		], "https://graph.instagram.com/v23.0/me/media?after=x"));
		const found = await findOwnInstagramPosts("token", ["https://www.instagram.com/reel/DYPUKXnM7Vk/?igsh=1"], { fetchImpl: fetchImpl as never });
		expect([...found]).toEqual([["https://www.instagram.com/reel/DYPUKXnM7Vk/", { id: "18034567890123456", caption: "Puzzle i Personalizuar Prej Druri" }]]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
	it("reads at most the newest pages, never follows a foreign next link, and finds nothing on errors", async () => {
		const many = vi.fn(async () => page([], "https://graph.instagram.com/v23.0/me/media?after=x"));
		expect((await findOwnInstagramPosts("token", ["https://www.instagram.com/reel/DYPUKXnM7Vk/"], { fetchImpl: many as never, maxPages: 2 })).size).toBe(0);
		expect(many).toHaveBeenCalledTimes(2);
		const foreign = vi.fn(async () => page([], "https://evil.example/me/media"));
		await findOwnInstagramPosts("token", ["https://www.instagram.com/reel/DYPUKXnM7Vk/"], { fetchImpl: foreign as never });
		expect(foreign).toHaveBeenCalledTimes(1);
		const failing = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 }));
		expect((await findOwnInstagramPosts("token", ["https://www.instagram.com/reel/DYPUKXnM7Vk/"], { fetchImpl: failing as never })).size).toBe(0);
		const none = vi.fn();
		expect((await findOwnInstagramPosts("token", ["https://lookaside.fbsbx.com/x"], { fetchImpl: none as never })).size).toBe(0);
		expect(none).not.toHaveBeenCalled();
	});
});
