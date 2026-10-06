import { describe, it, expect } from "vitest";
import { emptyMetadata, validateIndex, type Catalog } from "./model";
import { rankCatalogs, routeIntent, readContext } from "./ranking";
import { rankKnowledge } from "./source-ranking";
const catalog = (id: string, more: Partial<Catalog> = {}): Catalog => ({
  id,
  business_id: "tenant",
  title: "Industrial pumps",
  source_type: "pdf",
  source_url: null,
  storage_path: "tenant/a.pdf",
  description: "Pompa industriale",
  metadata: {
    ...emptyMetadata,
    languages: ["EN"],
    markets: ["Germany"],
    industries: ["water"],
  },
  ai_summary: "",
  use_when: ["technical"],
  qualification_fields: [],
  active: true,
  index_status: "ready",
  confirmed_at: "2026-01-01",
  updated_at: "2026-10-01",
  share_token: "a".repeat(64),
  revision: 1,
  index_error: null,
  coverage: "",
  ...more,
});
describe("catalog source selection", () => {
  it("routes documents separately from exact commercial information", () => {
    expect(routeIntent("Më dërgo katalogun teknik")).toBe("catalog");
    expect(routeIntent("price list")).toBe("catalog");
    expect(routeIntent("price for SKU A22")).toBe("product");
    expect(routeIntent("stok për variantin M")).toBe("product");
  });
  it("excludes inactive, unconfirmed, wrong language, market and industry", () => {
    const good = catalog("good");
    const rows = [
      good,
      catalog("inactive", { active: false }),
      catalog("draft", { confirmed_at: null }),
      catalog("wrong", { metadata: { ...good.metadata, languages: ["IT"] } }),
    ];
    const result = rankCatalogs(rows, [], "industrial pumps", {
      language: "anglisht",
      market: "gjermani",
      industry: "water",
    });
    expect(result.map((r) => r.catalog.id)).toEqual(["good"]);
    expect(rankCatalogs(rows, [], "pumps", { market: "Albania" })).toEqual([]);
  });
  it("uses semantic relevance and confirmed use rules in ranking", () => {
    const a = catalog("a", { use_when: [] }),
      b = catalog("b");
    const hits = [a, b].map((c) => ({
      catalog_id: c.id,
      heading: "Pumps",
      body: "Pumps",
      page: 2,
      semantic: 0.8,
    }));
    expect(
      rankCatalogs([a, b], hits, "technical pump datasheet", {})[0].catalog.id,
    ).toBe("b");
  });
  it("bounds ephemeral qualification context", () => {
    expect(
      readContext({
        query: "pumps",
        requirements: { market: "Germany", injected: "ignore" },
        pending: "market",
        turns: 2,
      }),
    ).toEqual({
      query: "pumps",
      requirements: { market: "Germany" },
      pending: "market",
      turns: 2,
    });
    expect(readContext({ query: "pumps", turns: 99 })).toBeNull();
  });
  it("validates document pages and index shape", () => {
    expect(() =>
      validateIndex({
        summary: "",
        coverage: "",
        sections: [
          { heading: "A", text: "Facts here", page: -1, keywords: [] },
        ],
      }),
    ).toThrow();
    expect(
      validateIndex({
        summary: "ok",
        coverage: "selective",
        metadata: { languages: ["EN"], injected: ["x"] },
        sections: [{ heading: "A", text: "Facts here", page: 2, keywords: [] }],
      }).metadata.languages,
    ).toEqual(["EN"]);
  });
  it("ranks services and knowledge by the current inquiry", () => {
    const rows = [
      { title: "Dërgesa", body: "Dy ditë" },
      {
        title: "Instalim industrial",
        body: "Shërbim sipas kërkesës",
        intent_key: "service",
      },
    ];
    expect(
      rankKnowledge(rows, "Dua instalim industrial")[0].entry.intent_key,
    ).toBe("service");
  });
});
