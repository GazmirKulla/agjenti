import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  index: vi.fn(),
  from: vi.fn(),
  signed: vi.fn(),
}));
vi.mock("./access", () => ({ catalogAccess: m.access }));
vi.mock("./indexing", () => ({ indexCatalog: m.index }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: m.rpc,
    from: m.from,
    storage: { from: () => ({ createSignedUrl: m.signed }) },
  }),
}));
import { POST } from "@/app/api/catalogs/[id]/index/route";
import { GET } from "@/app/api/catalogs/share/[token]/route";
const request = () =>
  new Request("https://agjenti.app/api/catalogs/doc/index?slug=shop", {
    method: "POST",
    headers: { origin: "https://agjenti.app" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test");
  m.access.mockResolvedValue({ business: { id: "tenant" } });
  m.rpc.mockResolvedValue({
    data: [{ id: "doc", business_id: "tenant", revision: 2 }],
  });
  m.index.mockResolvedValue(undefined);
});
it("indexing authorizes before any service writes or provider calls", async () => {
  m.access.mockRejectedValue(new Error("unauthorized"));
  expect(
    (await POST(request(), { params: Promise.resolve({ id: "doc" }) })).status,
  ).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.index).not.toHaveBeenCalled();
});
it("rejects cross-origin indexing", async () => {
  const req = new Request(
    "https://agjenti.app/api/catalogs/doc/index?slug=shop",
    { method: "POST", headers: { origin: "https://evil.test" } },
  );
  expect(
    (await POST(req, { params: Promise.resolve({ id: "doc" }) })).status,
  ).toBe(403);
  expect(m.access).not.toHaveBeenCalled();
});
it("claims tenant document and indexes into review", async () => {
  expect(
    (await POST(request(), { params: Promise.resolve({ id: "doc" }) })).status,
  ).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("claim_catalog_index", {
    p_id: "doc",
    p_business: "tenant",
  });
  expect(m.index).toHaveBeenCalledWith(
    expect.objectContaining({ business_id: "tenant", revision: 2 }),
  );
});
it("does not run duplicate or foreign indexing claims", async () => {
  m.rpc.mockResolvedValue({ data: [] });
  expect(
    (await POST(request(), { params: Promise.resolve({ id: "foreign" }) }))
      .status,
  ).toBe(409);
  expect(m.index).not.toHaveBeenCalled();
});
it("serves only active confirmed share tokens with no caching", async () => {
  const filters: unknown[][] = [];
  const chain = {
    select: () => chain,
    eq: (...v: unknown[]) => {
      filters.push(v);
      return chain;
    },
    not: (...v: unknown[]) => {
      filters.push(v);
      return chain;
    },
    maybeSingle: async () => ({ data: { storage_path: "tenant/doc.pdf" } }),
  };
  m.from.mockReturnValue(chain);
  m.signed.mockResolvedValue({
    data: { signedUrl: "https://storage.example/doc?signed=yes" },
  });
  const response = await GET(new Request("https://agjenti.app"), {
    params: Promise.resolve({ token: "a".repeat(64) }),
  });
  expect(response.status).toBe(302);
  expect(filters).toContainEqual(["active", true]);
  expect(filters).toContainEqual(["confirmed_at", "is", null]);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(m.signed).toHaveBeenCalledWith("tenant/doc.pdf", 60, {
    download: true,
  });
});
it("rejects malformed document tokens without a DB lookup", async () => {
  expect(
    (
      await GET(new Request("https://agjenti.app"), {
        params: Promise.resolve({ token: "../secrets" }),
      })
    ).status,
  ).toBe(404);
  expect(m.from).not.toHaveBeenCalled();
});
