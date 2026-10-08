import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanBusinessProfile, fetchInstagramBusinessProfile } from "./business-profile";
afterEach(() => vi.unstubAllGlobals());
describe("business profile metadata", () => {
  it("retrieves available fields independently when one optional field is rejected", async () => {
    const fetch = vi.fn(async (input: URL, options: RequestInit) => {
      expect(options.headers).toEqual({ Authorization: "Bearer private-token" });
      expect(input.searchParams.has("access_token")).toBe(false);
      expect(input.pathname).toContain("/123456");
      const fields = input.searchParams.get("fields")!;
      const values: Record<string, string> = { name: "Filiz Studio", username: "filiz_studio_", biography: "Fletë pune edukative për fëmijë. Shkarko PDF.", website: "filiz-studio.com" };
      return fields.includes(",") || fields === "profile_picture_url" ? { ok: false } : { ok: true, json: async () => ({ [fields]: values[fields] }) };
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchInstagramBusinessProfile("private-token", "123456");
    expect(result.data).toMatchObject({ name: "Filiz Studio", biography: expect.stringContaining("PDF"), website: "https://filiz-studio.com/" });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("retains partial combined metadata and falls back to an explicit bio link", async () => {
    const fetch = vi.fn(async (input: URL) => input.searchParams.get("fields")!.includes(",") ? { ok: true, json: async () => ({ name: "Studio", biography: "Visit https://filiz-studio.com/materials." }) } : { ok: false });
    vi.stubGlobal("fetch", fetch);
    expect((await fetchInstagramBusinessProfile("token", "123")).data).toMatchObject({ name: "Studio", website: "https://filiz-studio.com/materials" });
    expect(cleanBusinessProfile({ website: "javascript:alert(1)", profile_picture_url: "https://secret:pass@example.test/image", biography: "Hello", access_token: "secret" })).toEqual({ biography: "Hello" });
  });
  it("optional API failures do not block post analysis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret provider details")));
    expect(await fetchInstagramBusinessProfile("token", "123")).toMatchObject({ data: {} });
  });
});
