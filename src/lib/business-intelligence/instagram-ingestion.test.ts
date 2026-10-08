import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ media: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { const q = { select: () => q, eq: () => q, neq: () => q, maybeSingle: async () => ({ data: { id: "connection", ig_user_id: "ig-account", status: "connected", username: "studio", access_token_ciphertext: "encrypted" }, error: null }) }; return { from: () => q }; } }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "token" }));
vi.mock("@/lib/instagram/media", () => ({ fetchInstagramMedia: m.media }));
vi.mock("@/lib/instagram/business-profile", () => ({ fetchInstagramBusinessProfile: m.profile }));
import { extractInstagram } from "./ingestion";
beforeEach(() => { vi.clearAllMocks(); m.profile.mockResolvedValue({ data: { name: "Studio", biography: "Fletë pune\nShkarko PDF", website: "https://studio.test/" }, note: "U lexua bio-ja." }); });
describe("Instagram profile and caption capture", () => {
  it("captures the header and URL together with unescaped source quotations", async () => {
    m.media.mockResolvedValue({ posts: [{ id: "post", caption: "Mësojmë së bashku\nÇdo ditë", permalink: "https://instagram.com/p/1", imageUrl: null, mediaType: "IMAGE" }] });
    const result = await extractInstagram("business");
    expect(m.profile).toHaveBeenCalledWith("token", "ig-account");
    expect(result).toMatchObject({ profile: { name: "Studio" }, website: "https://studio.test/", postCount: 1 });
    expect(result.text).toContain("Fletë pune\nShkarko PDF");
    expect(result.text).toContain("Mësojmë së bashku\nÇdo ditë");
    expect(result.text).not.toContain("token");
  });
  it("uses a readable bio even when the media endpoint is unavailable", async () => {
    m.media.mockResolvedValue({ error: "No media access" });
    expect(await extractInstagram("business")).toMatchObject({ postCount: 0, images: [], profile: { name: "Studio" } });
    m.profile.mockResolvedValue({ data: {}, note: "" });
    await expect(extractInstagram("business")).rejects.toThrow("No media access");
  });
});
