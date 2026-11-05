// Existing scenarios run with the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS], requireModuleAllowed: async () => {} };
});
import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), create: vi.fn(), embed: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; embeddings = { create: mocks.embed }; } }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => mocks,
}));
import { retrieveBusinessSources } from "./retrieval";
import { questions } from "./ranking";
import { emptyMetadata } from "./model";
it("R2 reports no matching sections without treating unrelated text as business evidence", async () => {
  mocks.rpc.mockResolvedValue({ data: [{ catalog_id: "doc", heading: "Refunds", body: "Unsupported refund promise", page: 4, semantic: 0 }] });
  const onRead = vi.fn();
  const first = await retrieveBusinessSources("tenant", "industrial pumps catalog", null);
  const result = await retrieveBusinessSources("tenant", "Germany", first?.context, undefined, onRead);
  expect(result?.evidence).not.toContain("Unsupported refund promise");
  expect(onRead.mock.calls.at(-1)?.[0]).toMatchObject({ source: "catalog_sections", businessId: "tenant", status: "no_match", reason: "insufficient_relevance_in_bounded_search" });
});
let filters: unknown[][] = [];
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  mocks.create.mockImplementation(async ({ input }: { input: string }) => {
    const { message } = JSON.parse(input);
    const market = ({ Germany: "Germany", Albania: "Albania" } as Record<string, string>)[message];
    return { status: "completed", output_text: JSON.stringify(Object.fromEntries(Object.keys(questions).map(key =>
      [key, key === "market" && market ? { value: market, evidence: message } : { value: null, evidence: null }])))};
  });
  mocks.embed.mockResolvedValue({ data: [{ embedding: Array(256).fill(0.1) }] });
  mocks.rpc.mockClear();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agjenti.app");
  filters = [];
  const chain = {
    select: () => chain,
    eq: (...a: unknown[]) => {
      filters.push(a);
      return chain;
    },
    not: () => chain,
    limit: async () => ({
      data: [
        {
          id: "doc",
          title: "Industrial pumps catalog",
          metadata: { ...emptyMetadata, markets: ["Germany"] },
          active: true,
          index_status: "ready",
          confirmed_at: "2026-01-01",
          updated_at: "2026-10-01",
          use_when: ["full_range"],
          qualification_fields: ["market"],
          share_token: "f".repeat(64),
        },
      ],
    }),
  };
  mocks.from.mockReturnValue(chain);
  mocks.rpc.mockResolvedValue({
    data: [
      {
        catalog_id: "doc",
        heading: "Industrial pumps",
        body: "Documented specification: 400 L/min.",
        page: 3,
        semantic: 0.85,
      },
    ],
  });
});
it("qualifies before sharing, then remembers the response without Meta or writes", async () => {
  const first = await retrieveBusinessSources(
    "tenant",
    "industrial pumps catalog",
    null,
  );
  expect(first?.clarification).toContain("shtet");
  expect(first?.documents).toEqual([]);
  const second = await retrieveBusinessSources(
    "tenant",
    "Germany",
    first?.context,
  );
  expect(second?.documents[0].url).toContain("/api/catalogs/share/");
  expect(second?.evidence).toContain("faqe 3");
  expect(filters).toContainEqual(["business_id", "tenant"]);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "search_catalog_sections",
    expect.objectContaining({ p_business: "tenant" }),
  );
});
it("does not send a mismatched market document", async () => {
  const first = await retrieveBusinessSources(
    "tenant",
    "industrial pumps catalog",
    null,
  );
  const second = await retrieveBusinessSources(
    "tenant",
    "Albania",
    first?.context,
  );
  expect(second?.documents).toEqual([]);
  expect(second?.clarification).toContain("Nuk gjeta");
});
it("preserves product-first lookup", async () => {
  expect(
    await retrieveBusinessSources("tenant", "price SKU A22", null),
  ).toBeNull();
});

it("keeps previous progress and never searches lexically when AI is unavailable", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const old = { query: "industrial pumps catalog", requirements: {}, pending: "market", turns: 1 };
  const result = await retrieveBusinessSources("tenant", "Germany", old);
  expect(result?.context).toEqual(old);
  expect(result?.documents).toEqual([]);
  expect(result?.clarification).toContain("Progresi është ruajtur");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not use full-text search when embedding or requirement interpretation fails", async () => {
  mocks.create.mockRejectedValueOnce(new Error("offline"));
  const result = await retrieveBusinessSources("tenant", "industrial pumps catalog", null);
  expect(result?.documents).toEqual([]);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
