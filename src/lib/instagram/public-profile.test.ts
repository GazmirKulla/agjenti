import { afterEach, expect, it, vi } from "vitest";
import { fetchPublicInstagram, normalizeInstagramUsername, publicScanAvailable, PublicInstagramError } from "./public-profile";

afterEach(() => vi.unstubAllEnvs());

it("normalizes the forms people type", () => {
  expect(normalizeInstagramUsername("@Zana.Store")).toBe("zana.store");
  expect(normalizeInstagramUsername("instagram.com/zana_store/")).toBe("zana_store");
  expect(normalizeInstagramUsername("zana..store")).toBeNull();
  expect(normalizeInstagramUsername("zana store")).toBeNull();
});

it("stays off until the platform account is configured", async () => {
  vi.stubEnv("META_DISCOVERY_TOKEN", "");
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
