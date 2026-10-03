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
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: (value: string) => {
    if (value === "cipher:business-secret") return "business-secret";
    throw new Error("bad cipher");
  },
  encryptSecret: (value: string) => `cipher:${value}`,
}));
import { fetchLinkedCatalog, probeLinkedCatalog } from "./zana";
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
function configure(
  source: string,
  url: string | null,
  secretCiphertext: string | null = null,
) {
  mocks.maybeSingle
    .mockResolvedValueOnce({ data: { catalog_source: source }, error: null })
    .mockResolvedValueOnce({
      data: {
        catalog_url: url,
        orders_url: null,
        secret_ciphertext: secretCiphertext,
        kind: source === "zana" ? "zana" : "http",
      },
      error: null,
    });
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
  it("selects the external integration and uses the stored business secret", async () => {
    configure(
      "external",
      "https://catalog.example.test/products",
      "cipher:business-secret",
    );
    mocks.fetch.mockResolvedValue(Response.json({ products: [] }));
    expect(await fetchLinkedCatalog("business-a")).toEqual([]);
    expect(mocks.eq).toHaveBeenCalledWith("kind", "http");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://catalog.example.test/products",
      expect.objectContaining({
        headers: { Authorization: "Bearer business-secret" },
      }),
    );
  });
  it("falls back to the legacy Zana env secret when no business secret is stored", async () => {
    vi.stubEnv("ZANA_API_BASE_URL", "https://zana.example.test");
    configure("zana", "/api/integrations/agjenti/catalog", null);
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

describe("catalog probe", () => {
  it("prefers the form API secret override", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { catalog_source: "zana" },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValueOnce({
      data: {
        catalog_url: null,
        orders_url: null,
        secret_ciphertext: null,
        kind: "zana",
      },
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      Response.json({
        products: [
          {
            id: "p1",
            name: "Puzzle A4",
            productType: "puzzle",
            price: 2500,
            currency: "ALL",
            formats: [{ id: "f1", name: "A4", price: 2500 }],
            colors: [{ id: "black", name: "E zezë" }],
          },
        ],
        productTypes: [{ id: "puzzle" }],
        formats: [{ id: "f1" }],
      }),
    );
    const result = await probeLinkedCatalog({
      businessId: "business-a",
      catalogUrl: "https://zana.example.test/api/integrations/agjenti/catalog",
      ordersUrl: "https://zana.example.test/api/integrations/agjenti/orders",
      apiSecret: "form-secret",
    });
    expect(result.ok).toBe(true);
    expect(result.productCount).toBe(1);
    expect(result.products[0]?.name).toBe("Puzzle A4");
    expect(result.authSent).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://zana.example.test/api/integrations/agjenti/catalog",
      expect.objectContaining({
        headers: { Authorization: "Bearer form-secret" },
      }),
    );
  });
});
