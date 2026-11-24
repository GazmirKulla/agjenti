import { describe, expect, it } from "vitest";
import { parseProductForm, shortenDescription } from "./parse";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe("parseProductForm", () => {
  it("accepts a full product payload", () => {
    const parsed = parseProductForm(
      form({
        name: "Bluzë",
        description: "Pambuk",
        sku: "BLZ-1",
        image_url: "https://cdn.example.com/a.jpg",
        price: "1800",
        currency: "all",
        product_type_id: "type-1",
        workflow_id: "wf-1",
        is_active: "on",
      }),
    );
    expect(parsed).toMatchObject({
      name: "Bluzë",
      description: "Pambuk",
      sku: "BLZ-1",
      price: 1800,
      currency: "ALL",
      productTypeId: "type-1",
      workflowId: "wf-1",
      isActive: true,
    });
  });

  it("rejects invalid image urls and currency", () => {
    expect(
      parseProductForm(form({ name: "Aa", image_url: "ftp://x", price: "1" })),
    ).toMatchObject({ error: expect.stringContaining("http") });
    expect(
      parseProductForm(form({ name: "Aa", currency: "LEKE", price: "1" })),
    ).toMatchObject({ error: expect.stringContaining("Monedha") });
  });
});

describe("price modes and customer choices", () => {
  const fields = [{ key: "gjatesia", label: "Gjatësia", type: "select" as const, unit: "m", variant: true }];
  it("reads a range with its unit and refuses an upper price below the lower one", () => {
    expect(parseProductForm(form({ name: "Dërrasa", price_mode: "range", price: "70000", price_max: "80000", price_unit: "m³" })))
      .toMatchObject({ price: 70000, priceMode: "range", priceMax: 80000, priceUnit: "m³" });
    expect(parseProductForm(form({ name: "Dërrasa", price_mode: "range", price: "70000" }))).toMatchObject({ error: expect.stringContaining("deri") });
    expect(parseProductForm(form({ name: "Dërrasa", price_mode: "range", price: "9", price_max: "8" }))).toHaveProperty("error");
  });
  it("a price on request has no amount; a form without the mode keeps the stored one", () => {
    expect(parseProductForm(form({ name: "Binare", price_mode: "request", price: "500" }), { requirePrice: true }))
      .toMatchObject({ price: null, priceMode: "request", priceMax: null });
    expect(parseProductForm(form({ name: "Binare", price: "500" }))).toMatchObject({ priceMode: null });
  });
  it("keeps the values the customer chooses from as a list on the product", () => {
    const parsed = parseProductForm(form({ name: "Dërrasa", item_kind: "product", choices_gjatesia: "2; 3 m | 4;; 2" }), { fields });
    expect(parsed).toMatchObject({ attributes: { gjatesia: ["2", "3", "4"] } });
  });
});

describe("shortenDescription", () => {
  it("truncates long copy for the agent catalog", () => {
    expect(shortenDescription("a".repeat(130)).endsWith("…")).toBe(true);
    expect(shortenDescription("  shkurt  ")).toBe("shkurt");
  });
  it("changes whether the agent takes orders only when the form shows the switch", () => {
    const base = { name: "Libri", price: "790", currency: "ALL" };
    const kept = parseProductForm(form(base));
    expect("error" in kept ? null : kept.agentOrders).toBeNull();
    const off = parseProductForm(form({ ...base, agent_orders_shown: "1" }));
    expect("error" in off ? null : off.agentOrders).toBe(false);
    const on = parseProductForm(form({ ...base, agent_orders_shown: "1", agent_orders: "on" }));
    expect("error" in on ? null : on.agentOrders).toBe(true);
  });
  it("stores which customer questions the product uses only for the ones the owner ticks", () => {
    const fields = [{ key: "teksti", label: "Teksti në bluzë", type: "text" as const, ask: true }, { key: "pako", label: "Pako", type: "text" as const, ask: true }];
    const parsed = parseProductForm(form({ name: "Bluzë", price: "1500", currency: "ALL", item_kind: "product", ask_teksti: "on" }), { fields });
    expect("error" in parsed ? null : parsed.attributes).toEqual({ teksti: true });
  });
});

describe("Publiko / Ruaj si draft", () => {
  const form = (extra: Record<string, string>) => { const f = new FormData(); Object.entries({ name: "Puzzle", price: "10", currency: "ALL", ...extra }).forEach(([k, v]) => f.set(k, v)); return f; };
  it("publishing makes the product public and sold by the agent", () => {
    expect(parseProductForm(form({ save_mode: "publish" }))).toMatchObject({ isActive: true, agentOrders: true });
  });
  it("a draft is hidden and keeps the stored ordering setting", () => {
    expect(parseProductForm(form({ save_mode: "draft" }))).toMatchObject({ isActive: false, agentOrders: null });
  });
});
