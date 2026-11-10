import { afterEach, expect, it, vi } from "vitest";
import { fetchPublicInstagram, normalizeInstagramUsername, publicScanAvailable, publicScanProvider, PublicInstagramError } from "./public-profile";

afterEach(() => vi.unstubAllEnvs());

it("normalizes the forms people type", () => {
  expect(normalizeInstagramUsername("@Zana.Store")).toBe("zana.store");
  expect(normalizeInstagramUsername("instagram.com/zana_store/")).toBe("zana_store");
  expect(normalizeInstagramUsername("zana..store")).toBeNull();
  expect(normalizeInstagramUsername("zana store")).toBeNull();
});

it("stays off until the platform account is configured", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "");
  vi.stubEnv("APIFY_TOKEN", "");
  expect(publicScanAvailable()).toBe(false);
  await expect(fetchPublicInstagram("zana")).rejects.toMatchObject({ reason: "unavailable" });
});

it("reads the public profile and posts through Business Discovery", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "token");
  vi.stubEnv("META_DISCOVERY_IG_USER_ID", "17841400000000000");
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    expect(String(url)).toContain("graph.facebook.com");
    expect(decodeURIComponent(String(url))).toContain("business_discovery.username(zana)");
    return new Response(JSON.stringify({ business_discovery: {
      username: "zana", name: "Zana Store", biography: "Bluza dhe fustane · https://zana.al", website: "https://zana.al",
      media: { data: [
        { id: "1", caption: "Fustan i ri", media_type: "IMAGE", media_url: "https://cdn.test/1.jpg", permalink: "https://instagram.com/p/1" },
        { id: "2", caption: "Video", media_type: "VIDEO", thumbnail_url: "https://cdn.test/2.jpg" },
      ] },
    } }), { status: 200 });
  });
  const result = await fetchPublicInstagram("zana", fetcher as unknown as typeof fetch);
  expect(result.profile).toMatchObject({ name: "Zana Store", website: "https://zana.al/" });
  expect(result.posts.map((p) => p.imageUrl)).toEqual(["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"]);
});

it("tells apart an account that cannot be read", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "token");
  vi.stubEnv("META_DISCOVERY_IG_USER_ID", "1");
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 110, message: "Invalid user id" } }), { status: 400 }));
  const error = await fetchPublicInstagram("personal.account", fetcher as unknown as typeof fetch).catch((e) => e);
  expect(error).toBeInstanceOf(PublicInstagramError);
  expect(error.reason).toBe("not_found");
});

it("prefers Meta and otherwise reads through Apify", () => {
  vi.stubEnv("APIFY_TOKEN", "apify");
  vi.stubEnv("META_DISCOVERY_TOKEN", "");
  expect(publicScanProvider()).toBe("apify");
  vi.stubEnv("META_DISCOVERY_TOKEN", "token");
  vi.stubEnv("META_DISCOVERY_IG_USER_ID", "1");
  expect(publicScanProvider()).toBe("meta");
});

it("reads the profile and only the last 5 posts through Apify", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "");
  vi.stubEnv("APIFY_TOKEN", "apify");
  const latestPosts = Array.from({ length: 12 }, (_, i) => ({ id: String(i), type: i === 1 ? "Video" : "Image", caption: `Post ${i}`,
    url: `https://www.instagram.com/p/${i}/`, displayUrl: `https://cdn.test/${i}.jpg` }));
  latestPosts[2] = { ...latestPosts[2], type: "Sidecar", childPosts: [{ id: "c1", type: "Image", displayUrl: "https://cdn.test/c1.jpg" }, { id: "c2", type: "Video", displayUrl: "https://cdn.test/c2.jpg" }] } as never;
  const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    expect(String(url)).toContain("api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items");
    expect(String(url)).not.toContain("apify&");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer apify");
    expect(JSON.parse(String(init?.body))).toMatchObject({ directUrls: ["https://www.instagram.com/zana/"], resultsType: "details" });
    return new Response(JSON.stringify([{ username: "zana", fullName: "Zana Store", biography: "Fustane", externalUrl: "https://zana.al", latestPosts }]), { status: 201 });
  });
  const result = await fetchPublicInstagram("zana", fetcher as unknown as typeof fetch);
  expect(result.profile).toMatchObject({ name: "Zana Store", website: "https://zana.al/" });
  expect(result.posts).toHaveLength(5);
  expect(result.posts[1].mediaType).toBe("VIDEO");
  expect(result.posts[2].images).toEqual([{ id: "c1", url: "https://cdn.test/c1.jpg" }]);
});

it("treats a private or missing account as not found on Apify", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "");
  vi.stubEnv("APIFY_TOKEN", "apify");
  for (const items of [[], [{ error: "not_found", url: "https://www.instagram.com/zana/" }], [{ username: "zana", private: true }]]) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(items), { status: 201 }));
    await expect(fetchPublicInstagram("zana", fetcher as unknown as typeof fetch)).rejects.toMatchObject({ reason: "not_found" });
  }
});
