import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exactBusinessAnswer, projectBusinessGrounding, readBusinessGrounding, readResult, type BusinessGrounding, type GroundedProduct } from "./business-grounding";
import { rankKnowledge } from "@/lib/catalogs/source-ranking";
import { renderProductReferences } from "@/lib/products/entity-bridge";

const products: GroundedProduct[] = [
  { id: "a", name: "Libri", price_amount: 20, currency: "EUR" },
  { id: "b", name: "Paketa Parashkollore", price_amount: 10, currency: "EUR" },
];
function read(rows = products): BusinessGrounding {
  return { products: readResult("products", "tenant", { data: rows, count: rows.length }),
    services: readResult("booking_services", "tenant", { data: [{ id: "s", name: "Konsulta", price_amount: 30, currency: "ALL", price_mode: "from", duration_minutes: 45, booking_enabled: false }], count: 1 }),
    knowledge: readResult("knowledge_entries", "tenant", { data: [], count: 0 }),
    documents: readResult("catalog_sections", "tenant", { data: [], count: 0 }),
    availability: "unverified", inventory: "unsupported", bookingModuleEnabled: false };
}
describe("R2 bounded authoritative evidence", () => {
  it("distinguishes failure, no match, disabled, complete and unknown completeness", () => {
    expect(readResult("products", "t", { data: [], error: {} })).toMatchObject({ status: "unavailable", reason: "read_failed", total: null });
    expect(readResult("products", "t", { data: [], count: 0 })).toMatchObject({ status: "no_match", total: 0 });
    expect(readResult("products", "t", { data: products, count: 2 }, false)).toMatchObject({ status: "unavailable", reason: "module_disabled", records: [], total: null });
    expect(readResult("products", "t", { data: products })).toMatchObject({ status: "partial", total: null });
    expect(readResult("products", "t", { data: products, count: 2 }).status).toBe("complete");
  });
  it("uses exact DB count rather than the bounded context or invented count", () => {
    const r = read(); r.products.total = 2000; r.products.status = "partial";
    expect(exactBusinessAnswer(r, "Sa produkte keni?")?.reply).toContain("2000 produkte aktive");
    expect(exactBusinessAnswer(r, "Cili është produkti më i lirë?")?.reply).toContain("vetëm një pjesë");
  });
  it("does not treat failed count as zero and never estimates an unknown count", () => {
    const r = read(); r.products = readResult("products", "tenant", { data: null, error: {} });
    expect(exactBusinessAnswer(r, "Sa produkte keni?")?.reply).toContain("nuk do të thotë");
    r.products = readResult("products", "tenant", { data: products });
    expect(exactBusinessAnswer(r, "Sa produkte keni?")?.reply).toContain("Nuk munda");
  });
  it("renders current exact prices and extrema without a model", () => {
    const r = read();
    expect(exactBusinessAnswer(r, "Sa kushton Paketa Parashkollore?")?.reply).toContain("10 EUR");
    expect(exactBusinessAnswer(r, "Cili është produkti më i lirë?")?.presentedProducts?.map(p => p.id)).toEqual(["b"]);
    expect(exactBusinessAnswer(r, "Cili është produkti më i shtrenjtë?")?.presentedProducts?.map(p => p.id)).toEqual(["a"]);
  });
  it("refreshes prices and count after a changed authorized read", () => {
    expect(exactBusinessAnswer(read(), "Sa produkte keni?")?.reply).toContain("2 produkte");
    const updated = read([{ ...products[0], price_amount: 99 }]);
    expect(exactBusinessAnswer(updated, "Sa produkte keni?")?.reply).toContain("1 produkte");
    expect(exactBusinessAnswer(updated, "Sa kushton Libri?")?.reply).toContain("99 EUR");
  });
  it.each([null, undefined, NaN])("does not invent a missing/invalid price %s", price_amount => {
    const r = read([{ ...products[0], price_amount }]);
    expect(exactBusinessAnswer(r, "Sa kushton Libri?")?.reply).toContain("nuk është i përcaktuar");
    expect(exactBusinessAnswer(r, "Cili është produkti më i lirë?")?.reply).toContain("Nuk mund");
  });
  it("does not convert currencies or silently resolve tied prices/names", () => {
    expect(exactBusinessAnswer(read([products[0], { ...products[1], currency: "ALL" }]), "Cili është produkti më i lirë?")?.reply).toContain("monedhat");
    const r = read(products.map(p => ({ ...p, price_amount: 10 })));
    expect(exactBusinessAnswer(r, "Cili është produkti më i lirë?")?.presentedProducts).toHaveLength(2);
    expect(exactBusinessAnswer(read([{ ...products[0], name: "Libri A" }, { ...products[1], name: "Libri B" }]), "Sa kushton Libri?")?.reply).toContain("një produkt ose shërbim të vetëm");
  });
  it("service price modes, duration, booking configuration and slots are distinct", () => {
    const r = read();
    expect(exactBusinessAnswer(r, "Sa kushton Konsulta?")?.reply).toContain("nga 30 ALL");
    expect(exactBusinessAnswer(r, "Sa zgjat Konsulta?")?.reply).toContain("45 min");
    expect(exactBusinessAnswer(r, "Çfarë shërbimesh keni?")?.reply).toContain("nuk konfirmon termine");
    r.services.records[0].price_mode = "request";
    expect(exactBusinessAnswer(r, "Sa kushton Konsulta?")?.reply).not.toContain("30 ALL");
    const projected = projectBusinessGrounding(r, "Konsulta");
    expect(projected).toMatchObject({ bookingModuleEnabled: false, availability: "unverified", services: { records: [{ booking_enabled: false }] } });
    expect(renderProductReferences("[[service:s]]", [{ ...r.services.records[0], price_mode: "from" }], "service").reply).toContain("nga 30 ALL");
    expect(renderProductReferences("[[service:s]]", r.services.records, "service").reply).not.toContain("30 ALL");
  });
  it("labels unsupported inventory without pretending catalog activation proves stock", () => {
    expect(exactBusinessAnswer(read(), "A keni Libri në stok?")?.reply).toContain("Nuk kam burim të verifikuar");
  });
  it("limits context, prioritizes verified IDs, and carries total/provenance/partial status", () => {
    const r = read(Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `Product ${i}`, description: "x".repeat(4000) })));
    const projected = projectBusinessGrounding(r, "Tell me about it", { kind: "product", id: "59" });
    expect(projected.products).toMatchObject({ status: "partial", reason: "context_limit", total: 60, businessId: "tenant", source: "products" });
    expect(projected.products.records).toHaveLength(12);
    expect(projected.products.records[0].id).toBe("59");
    expect(projected.products.records[0].description).toHaveLength(600);
    expect(r.products.records[0].description).toHaveLength(4000);
  });
  it("excludes zero relevance and service mirrors; retains conflicting relevant policy provenance", () => {
    const r = read();
    r.knowledge = readResult("knowledge_entries", "tenant", { data: [
      { id: "k1", title: "Refund", body: "Refund within 10 days" },
      { id: "k2", title: "Refund", body: "Refund within 20 days" },
      { id: "k3", title: "Shipping", body: "Unrelated delivery" },
      { id: "k4", title: "Refund", body: "Stale service price", intent_key: "service" },
    ], count: 4 });
    expect(rankKnowledge(r.knowledge.records, "quantum physics")).toEqual([]);
    expect(rankKnowledge([{ title: "Other topic", body: "Refund" }], "refund quantum physics chemistry astronomy geology history science medicine")).toEqual([]);
    const result = projectBusinessGrounding(r, "What is the refund policy?");
    expect(result.knowledge.records.map(k => k.id)).toEqual(["k1", "k2"]);
    expect(result.knowledge.status).toBe("partial"); // no guessed winner/full policy
    expect(projectBusinessGrounding(r, "Discount policy?").knowledge.status).toBe("no_match");
  });
  it("module OFF cannot expose current facts, counts or price comparisons", () => {
    const r = read(); r.products = readResult("products", "tenant", { data: products, count: 2 }, false);
    expect(exactBusinessAnswer(r, "Sa produkte keni?")?.reply).toContain("çaktivizuar");
    expect(projectBusinessGrounding(r, "Libri").products.records).toEqual([]);
  });
});

it("read adapter keeps tenant/active filters and exact count, never invokes a write or a disabled module", async () => {
  const calls: { table: string; filters: unknown[][]; select?: unknown[]; limit?: number }[] = [];
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as unknown[][], select: undefined as unknown[] | undefined, limit: undefined as number | undefined }; calls.push(call);
    const query = { select: (...args: unknown[]) => { call.select = args; return query; },
      eq: (...args: unknown[]) => { call.filters.push(args); return query; }, order: () => query,
      limit: async (limit: number) => { call.limit = limit; return { data: products, count: 2000, error: null }; } };
    return query;
  });
  const r = await readBusinessGrounding({ from } as unknown as SupabaseClient, "synthetic-tenant", ["products"]);
  expect(calls).toEqual([{ table: "products", filters: [["business_id", "synthetic-tenant"], ["is_active", true]], select: [expect.any(String), { count: "exact" }], limit: 1000 }]);
  expect(r.products).toMatchObject({ status: "partial", total: 2000, businessId: "synthetic-tenant" });
  expect(r.services).toMatchObject({ status: "unavailable", reason: "module_disabled" });
});
