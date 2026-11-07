import { beforeEach, expect, it, vi } from "vitest";
import { processGroundingContext } from "./grounding-context";
import type { BusinessGrounding } from "@/lib/agents/business-grounding";
const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/lib/conversations/understanding/selection", () => ({ selectSemanticCandidates: select }));
beforeEach(() => { select.mockReset(); });
function grounding() {
  const metadata = { businessId: "business", status: "complete" as const, total: 0, records: [], retrievedAt: "now" };
  return { products: { ...metadata, source: "products", total: 50, records: Array.from({ length: 50 }, (_, index) => ({ id: `product-${index}`, name: `Product ${index}` })) },
    services: { ...metadata, source: "booking_services" }, knowledge: { ...metadata, source: "knowledge_entries" },
    documents: { ...metadata, source: "catalog_sections" }, bookingModuleEnabled: true, availability: "unverified", inventory: "unsupported" } satisfies BusinessGrounding;
}
it("can select a matching product beyond the first twenty rows while preserving the database count", async () => {
  select.mockResolvedValue([{ index: 49, score: 1, evidence: "last" }]);
  const result = await processGroundingContext(grounding(), "last", Date.now() + 1000);
  expect(result.products.records.map(p => p.id)).toEqual(["product-49"]);
  expect(result.products).toMatchObject({ total: 50, status: "partial", reason: "semantic_context_subset" });
});
it("does not substitute arbitrary products when semantic selection fails", async () => {
  select.mockRejectedValue(new Error("offline"));
  const result = await processGroundingContext(grounding(), "request", Date.now() + 1000);
  expect(result.products).toMatchObject({ records: [], total: 50, status: "partial", reason: "semantic_context_unavailable" });
});
it("keeps a presented catalog id outside the semantic subset", async () => {
  select.mockResolvedValue([{ index: 0, score: 1, evidence: "first" }]);
  const result = await processGroundingContext(grounding(), "first", Date.now() + 1000, { productIds: ["product-49"] });
  expect(result.products.records.map(p => p.id)).toEqual(["product-49", "product-0"]);
  expect(result.products.status).toBe("partial");
});
it("keeps the presented id when semantic ranking is unavailable", async () => {
  select.mockRejectedValue(new Error("offline"));
  const result = await processGroundingContext(grounding(), "request", Date.now() + 1000, { productIds: ["product-49"] });
  expect(result.products.records.map(p => p.id)).toEqual(["product-49"]);
});
