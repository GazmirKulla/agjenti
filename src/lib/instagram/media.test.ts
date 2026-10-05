import { describe, expect, it } from "vitest";
import { fetchInstagramMedia, postsFromMediaPage, productsFromPosts, scanFramesFromPosts } from "./media";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("postsFromMediaPage", () => {
	it("keeps a video thumbnail and drops a next link outside Instagram", () => {
		const page = postsFromMediaPage({
			data: [
				{
					id: "123456",
					caption: "Karrige\n12 EUR",
					media_type: "VIDEO",
					media_url: "https://cdn.example/video.mp4",
					thumbnail_url: "https://cdn.example/thumb.jpg",
					permalink: "https://www.instagram.com/p/abc/",
				},
				{ id: "nope", caption: "Jo" },
			],
			paging: { next: "https://evil.example/steal?access_token=secret" },
		});
		expect(page.next).toBeNull();
		expect(page.posts).toEqual([
			{
				id: "123456",
				caption: "Karrige\n12 EUR",
				mediaType: "VIDEO",
				imageUrl: "https://cdn.example/thumb.jpg",
				permalink: "https://www.instagram.com/p/abc/",
			},
		]);
	});
});

describe("productsFromPosts", () => {
	it("turns a priced caption into one reviewable product", () => {
		const [product] = productsFromPosts([
			{
				id: "123456",
				caption: "Karrige\n12 EUR",
				mediaType: "IMAGE",
				imageUrl: "https://cdn.example/a.jpg",
				permalink: "https://www.instagram.com/p/abc/",
			},
		]);
		expect(product).toMatchObject({
			externalId: "ig:123456",
			name: "Karrige",
			price: 12,
			currency: "EUR",
			imageUrl: "https://cdn.example/a.jpg",
			permalink: "https://www.instagram.com/p/abc/",
		});
	});
});

describe("scanFramesFromPosts", () => {
	it("keeps a short preview and marks only posts that have a price", () => {
		const frames = scanFramesFromPosts([
			{
				id: "123456",
				caption: "#oferta\nBluza e re\n790 Lekë",
				mediaType: "IMAGE",
				imageUrl: "https://cdn.example/a.jpg",
				permalink: "https://www.instagram.com/p/abc/",
			},
			{
				id: "234567",
				caption: "Vetem foto",
				mediaType: "IMAGE",
				imageUrl: "javascript:alert(1)",
				permalink: null,
			},
		]);
		expect(frames).toEqual([
			{
				id: "123456",
				imageUrl: "https://cdn.example/a.jpg",
				preview: "Bluza e re",
				found: { name: "Bluza e re", price: 790, currency: "ALL" },
			},
			{
				id: "234567",
				imageUrl: null,
				preview: "Vetem foto",
				found: null,
			},
		]);
	});
});

describe("fetchInstagramMedia", () => {
	it("does not follow a next page outside graph.instagram.com", async () => {
		const calls: string[] = [];
		const fetchImpl: typeof fetch = async (input) => {
			const url = new URL(String(input));
			calls.push(url.hostname + url.pathname);
			return jsonResponse({
				data: [
					{
						id: "123456",
						caption: "Bluza\n790 Lekë",
						media_type: "IMAGE",
						media_url: "https://cdn.example/a.jpg",
					},
				],
				paging: { next: "https://evil.example/steal?access_token=secret" },
			});
		};
		const result = await fetchInstagramMedia("super-secret-token", fetchImpl);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/^graph\.instagram\.com\/v[\d.]+\/me\/media$/);
		expect(result).toMatchObject({ truncated: false, posts: [{ id: "123456" }] });
	});

	it("retries once when the first field set is rejected", async () => {
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			if (calls === 1) return jsonResponse({ error: { code: 100, message: "bad field" } }, 400);
			return jsonResponse({
				data: [{ id: "123456", caption: "Karrige\n12 EUR", media_type: "IMAGE", media_url: "https://cdn.example/a.jpg" }],
			});
		};
		const result = await fetchInstagramMedia("token", fetchImpl);
		expect(calls).toBe(2);
		expect(result).toMatchObject({ posts: [{ id: "123456" }] });
	});

	it("hides the token when the request fails", async () => {
		const fetchImpl: typeof fetch = async (input) => {
			throw new Error(String(input));
		};
		const result = await fetchInstagramMedia("super-secret-token", fetchImpl);
		expect(result).toEqual({ error: "Instagram nuk u përgjigj. Provo përsëri." });
		expect(JSON.stringify(result)).not.toContain("super-secret-token");
	});
});
