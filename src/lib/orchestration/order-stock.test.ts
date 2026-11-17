import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ product: null as unknown, variants: [] as unknown[], productError: null as unknown, variantError: null as unknown }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: db.product, error: db.productError }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === "product_variants" ? { data: db.variants, error: db.variantError } : { data: null, error: null }).then(resolve) });
  return query;
} }) }));
import { readOrderStock } from "./order-context";

const business = "00000000-0000-4000-8000-000000000001", product = "00000000-0000-4000-8000-000000000002";
beforeEach(() => { db.product = null; db.variants = []; db.productError = null; db.variantError = null; });

describe("the server's stock check before an agent order", () => {
  it("never blocks stock that is not counted, nor a database before the stock migration", async () => {
    db.product = { stock_mode: "off", stock_quantity: null, source: "manual" };
    expect(await readOrderStock(business, product, {}, 50)).toBe("ok");
    db.productError = { code: "42703" };
    expect(await readOrderStock(business, product, {}, 50)).toBe("ok");
  });
  it("refuses an order above the product's count and fails closed when stock cannot be read", async () => {
    db.product = { stock_mode: "tracked", stock_quantity: 1, source: "manual" };
    expect(await readOrderStock(business, product, {}, 1)).toBe("ok");
    expect(await readOrderStock(business, product, {}, 2)).toBe("out");
    db.productError = { code: "57014" };
    expect(await readOrderStock(business, product, {}, 1)).toBe("unverified");
  });
  it("checks the chosen variant, or any choice when none is chosen yet", async () => {
    db.product = { stock_mode: "tracked", stock_quantity: null, source: "manual" };
    db.variants = [{ options: { gjatesia: "80" }, is_active: true, stock_quantity: 0 }, { options: { gjatesia: "120" }, is_active: true, stock_quantity: 2 }];
    expect(await readOrderStock(business, product, { variant_gjatesia: "80" }, 1)).toBe("out");
    expect(await readOrderStock(business, product, { variant_gjatesia: "120" }, 1)).toBe("ok");
    expect(await readOrderStock(business, product, {}, 1)).toBe("ok");
    db.variants = db.variants.map(v => ({ ...(v as object), stock_quantity: 0 }));
    expect(await readOrderStock(business, product, {}, 1)).toBe("out");
  });
});
