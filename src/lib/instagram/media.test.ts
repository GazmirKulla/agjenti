import { describe, expect, it } from "vitest";
import {
	fetchInstagramMedia,
	fetchPublicInstagramMedia,
	parseInstagramUsername,
	postsFromDiscovery,
	postsFromMediaPage,
	productsFromPosts,
} from "./media";

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

describe("parseInstagramUsername", () => {
	it("reads a handle or a profile link", () => {
		expect(parseInstagramUsername("@Filiz.studio")).toBe("Filiz.studio");
		expect(parseInstagramUsername("https://www.instagram.com/filiz.studio/?hl=en")).toBe("filiz.studio");
		expect(parseInstagramUsername("https://www.instagram.com/p/abc/")).toBeNull();
		expect(parseInstagramUsername("blue)bottle")).toBeNull();
	});
});

describe("postsFromDiscovery", () => {
	it("reads media nested under the public account", () => {
		const page = postsFromDiscovery({
			business_discovery: {
				media: {
					data: [
						{
							id: "123456",
							caption: "Karrige\n12 EUR",
							media_type: "IMAGE",
							media_url: "https://cdn.example/a.jpg",
							permalink: "https://www.instagram.com/p/abc/",
						},
					],
					paging: { cursors: { after: "cursor_1" }, next: "https://evil.example/next" },
				},
			},
		});
		expect(page.next).toBeNull();
		expect(page.after).toBe("cursor_1");
		expect(page.posts).toHaveLength(1);
	});
});

describe("fetchPublicInstagramMedia", () => {
	it("asks Instagram for the public account and keeps the token out of errors", async () => {
		const calls: string[] = [];
		const fetchImpl: typeof fetch = async (input) => {
			const url = new URL(String(input));
			calls.push(`${url.hostname}${url.pathname}`);
			expect(url.searchParams.get("fields")).toContain("business_discovery.username(bluebottle)");
			throw new Error(url.searchParams.get("access_token") ?? "");
		};
		const result = await fetchPublicInstagramMedia("super-secret-token", "17841400000000000", "https://instagram.com/bluebottle/", fetchImpl);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/^graph\.instagram\.com\/v[\d.]+\/17841400000000000$/);
		expect(JSON.stringify(result)).not.toContain("super-secret-token");
	});

	it("tries the other official host when the first refuses the lookup", async () => {
		const hosts: string[] = [];
		const fetchImpl: typeof fetch = async (input) => {
			const url = new URL(String(input));
			hosts.push(url.hostname);
			if (hosts.length === 1) return jsonResponse({ error: { code: 10 } }, 400);
			return jsonResponse({
				business_discovery: {
					media: {
						data: [
							{
								id: "123456",
								caption: "Bluza\n790 Lekë",
								media_type: "IMAGE",
								media_url: "https://cdn.example/a.jpg",
							},
						],
					},
				},
			});
		};
		const result = await fetchPublicInstagramMedia("token", "17841400000000000", "@bluebottle", fetchImpl);
		expect(hosts).toEqual(["graph.instagram.com", "graph.facebook.com"]);
		expect(result).toMatchObject({ posts: [{ id: "123456" }] });
	});

	it("does not ask another host when the account does not exist", async () => {
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return jsonResponse({ error: { code: 110 } }, 400);
		};
		const result = await fetchPublicInstagramMedia("token", "17841400000000000", "bluebottle", fetchImpl);
		expect(calls).toBe(1);
		expect(result).toEqual({
			error: "Kjo llogari nuk u gjet, ose nuk është profesionale dhe publike.",
		});
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
