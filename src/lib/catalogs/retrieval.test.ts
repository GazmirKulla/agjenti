import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => mocks,
}));
import { retrieveBusinessSources } from "./retrieval";
import { emptyMetadata } from "./model";
let filters: unknown[][] = [];
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
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
