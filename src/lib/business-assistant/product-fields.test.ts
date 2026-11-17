import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemKind } from "@/lib/items/kinds";
import type { BusinessField } from "@/lib/items/fields";

const m = vi.hoisted(() => ({ variants: { data: [] as unknown[], error: null as unknown }, calls: [] as unknown[][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ["select", "eq", "in", "order"]) q[name] = (...args: unknown[]) => { m.calls.push([table, name, ...args]); return q; };
  q.range = async () => m.variants;
  return q;
} }) }));
const { compactProduct, describeProducts, fitRows, productSchema, unknownProductSetup } = await import("./product-fields");

const own: BusinessField[] = [
  { key: "mosha", label: "Mosha e rekomanduar", type: "text" },
  { key: "faqe", label: "Faqe", type: "number" },
  { key: "ngjyra", label: "Ngjyra", type: "select", variant: true },
];
const setup = { kind: itemKind("product"), fields: own, fieldsRead: true };
const row = { id: "p1", name: "Paketa", price_amount: 990, currency: "ALL", is_active: true, archived_at: null, updated_at: "2026-11-16T10:00:00Z",
  item_kind: "product", description: "x".repeat(1000), attributes: { mosha: "3-5 vjec", faqe: 120, hequr: "vlerë e vjetër" } };

describe("owner assistant product context", () => {
  beforeEach(() => { m.variants = { data: [], error: null }; m.calls = []; });

  it("states each fact once: values by key, removed fields apart, identity kept for update matching", () => {
    const compact = compactProduct(row, productSchema(setup));
    expect(compact).toMatchObject({ id: "p1", updated_at: "2026-11-16T10:00:00Z", values: { mosha: "3-5 vjec", faqe: 120 }, unmappedValues: { hequr: "vlerë e vjetër" } });
    expect(compact).not.toHaveProperty("attributes");
    expect(String(compact.description).length).toBeLessThanOrEqual(301);
  });

  it("lists the fields of every kind the products use, plus the business's own", () => {
    const schema = productSchema(setup, ["property"]);
    expect(schema.fields.map(f => f.key)).toEqual(expect.arrayContaining(["size_m2", "mosha", "ngjyra"]));
    expect(schema.fields.find(f => f.key === "ngjyra")).toMatchObject({ variant: true, source: "business" });
  });

  it("marks fields unknown, never empty, when the setup could not be read", () => {
    expect(productSchema(unknownProductSetup())).toMatchObject({ status: "unavailable", fields: [] });
  });

  it("reads variants only for the products shown and bounds them per product", async () => {
    m.variants = { data: Array.from({ length: 25 }, (_, i) => ({ product_id: "p1", options: { ngjyra: `N${i}` }, sku: null, price_amount: 1000 + i })), error: null };
    const described = await describeProducts("b1", setup, [row]);
    expect(m.calls).toContainEqual(["product_variants", "in", "product_id", ["p1"]]);
    expect(m.calls).toContainEqual(["product_variants", "eq", "business_id", "b1"]);
    expect(described.rows[0].variants).toMatchObject({ total: 25 });
    expect((described.rows[0].variants as { shown: unknown[] }).shown).toHaveLength(10);
    expect(described.variants).toBe("read");
  });

  it("says variants are unavailable instead of none when they cannot be read", async () => {
    m.variants = { data: null as unknown as unknown[], error: { message: "down" } };
    expect((await describeProducts("b1", setup, [row])).variants).toBe("unavailable");
  });

  it("keeps a large catalog within the size budget and says it was cut", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...row, id: `p${i}`, attributes: Object.fromEntries(Array.from({ length: 24 }, (_, f) => [`f${f}`, "v".repeat(120)])) }));
    const described = await describeProducts("b1", { ...setup, fields: [] }, many);
    expect(JSON.stringify(described.rows).length).toBeLessThanOrEqual(40_000);
    expect(described.cut).toBe(true);
    expect(fitRows([1, 2, 3], 100)).toEqual({ rows: [1, 2, 3], cut: false });
  });
});
