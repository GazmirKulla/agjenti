import { describe, expect, it } from "vitest";
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
