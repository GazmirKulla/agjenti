import { expect, it } from "vitest";
import { matches, rankCatalogs } from "@/lib/catalogs/ranking";
import { emptyMetadata, type Catalog } from "@/lib/catalogs/model";

it.each([["UK", "Ukraine"], ["US", "Russia"], ["US", "Australia"]])(
  "does not treat a %s catalog as supporting the distinct requested market %s",
  (supported, requested) => {
    expect(matches([supported], requested)).toBe(false);
  },
);

it("excludes a UK-only catalog when the explicit qualification answer is Ukraine", () => {
  const catalog: Catalog = {
    id: "uk-document", business_id: "audit-tenant", title: "Industrial pumps catalog",
    source_type: "pdf", source_url: null, storage_path: "audit-tenant/pumps.pdf",
    description: "Technical industrial pumps", metadata: { ...emptyMetadata, markets: ["UK"] },
    ai_summary: "", use_when: ["full_range"], qualification_fields: ["market"],
    active: true, index_status: "ready", confirmed_at: "2026-10-01", updated_at: "2026-10-01",
    share_token: "a".repeat(64), revision: 1, index_error: null, coverage: "selective",
  };
  const hits = [{ catalog_id: catalog.id, heading: "Pumps", body: "UK specification", page: 1, semantic: 0.95 }];
  expect(rankCatalogs([catalog], hits, "Industrial pumps catalog Ukraine", { market: "Ukraine" })).toEqual([]);
});

it("still supports explicit, known language and market aliases", () => {
  expect(matches(["EN"], "anglisht")).toBe(true);
  expect(matches(["Germany"], "gjermani")).toBe(true);
});
