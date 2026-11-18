import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ product: null as unknown }));
vi.mock("@/lib/capabilities/enforcement", () => ({ requireRuntimeModules: async () => undefined }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, eq: () => query, order: () => query,
    maybeSingle: async () => ({ data: db.product, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === "product_variants" ? { data: [], error: null } : { data: null, error: null }).then(resolve) });
  return query;
} }) }));
import { readOrderTerms } from "./order-context";

const business = "00000000-0000-4000-8000-000000000001", product = "00000000-0000-4000-8000-000000000002";
const priced = { id: product, name: "Libri", product_type_id: null, price_amount: 790, price_mode: "fixed", price_unit: null, currency: "ALL", attributes: {}, source: "manual", external_spec: null };
beforeEach(() => { db.product = null; });

describe("a product the owner keeps for information only", () => {
  it("is never ordered by the agent, whatever its price, and says why", async () => {
    db.product = { ...priced, agent_orders: false };
    await expect(readOrderTerms(business, product, false, {})).rejects.toMatchObject({ code: "product_information_only" });
  });
  it("is still collected as a request for staff, and every other product is ordered as before", async () => {
    db.product = { ...priced, agent_orders: false };
    await expect(readOrderTerms(business, product, true, {})).resolves.toMatchObject({ productId: product });
    db.product = { ...priced, agent_orders: true };
    await expect(readOrderTerms(business, product, false, {})).resolves.toMatchObject({ productId: product, unitAmount: 790, currency: "ALL" });
  });
});
