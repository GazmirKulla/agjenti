import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
import { fetchLinkedCatalog } from "./zana";
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    eq: mocks.eq,
    select: mocks.select,
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("ZANA_API_BASE_URL", "");
  vi.stubEnv("ZANA_AGJENTI_SECRET", "test-only-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function configure(source: string, url: string | null) {
  mocks.maybeSingle
    .mockResolvedValueOnce({ data: { catalog_source: source }, error: null })
    .mockResolvedValueOnce({ data: { catalog_url: url }, error: null });
}
describe("linked catalog resilience", () => {
  it("reports an unconfigured relative URL before attempting a request", async () => {
    configure("zana", "/api/integrations/agjenti/catalog");
    await expect(fetchLinkedCatalog("business-a")).rejects.toThrow(
      "URL-ja e katalogut",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not build a URL from an empty base", async () => {
    configure("zana", null);
    await expect(fetchLinkedCatalog("business-a")).rejects.toThrow(
      "nuk është konfiguruar",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("selects the external integration without disclosing the Zana credential", async () => {
    configure("external", "https://catalog.example.test/products");
    mocks.fetch.mockResolvedValue(Response.json({ products: [] }));
    expect(await fetchLinkedCatalog("business-a")).toEqual([]);
    expect(mocks.eq).toHaveBeenCalledWith("kind", "http");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://catalog.example.test/products",
      expect.objectContaining({ headers: {} }),
    );
  });
  it("resolves the Zana endpoint and authenticates only to its configured origin", async () => {
    vi.stubEnv("ZANA_API_BASE_URL", "https://zana.example.test");
    configure("zana", "/api/integrations/agjenti/catalog");
    mocks.fetch.mockResolvedValue(
      Response.json({
        products: [
          { id: "p1", name: "Puzzle", price: 2500, productType: null },
        ],
      }),
    );
    expect(await fetchLinkedCatalog("business-a")).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://zana.example.test/api/integrations/agjenti/catalog",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-only-secret" },
      }),
    );
  });
  it("reports network failures without exposing endpoint details", async () => {
    configure("external", "https://catalog.example.test/products");
    mocks.fetch.mockRejectedValue(new Error("private network details"));
    await expect(fetchLinkedCatalog("business-a")).rejects.toThrow(
      "nuk përgjigjet",
    );
  });
  it("rejects malformed upstream responses", async () => {
    configure("external", "https://catalog.example.test/products");
    mocks.fetch.mockResolvedValue(Response.json({ invalid: true }));
    await expect(fetchLinkedCatalog("business-a")).rejects.toThrow(
      "formatin e pritur",
    );
  });
});
