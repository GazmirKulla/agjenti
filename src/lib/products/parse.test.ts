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

describe("shortenDescription", () => {
  it("truncates long copy for the agent catalog", () => {
    expect(shortenDescription("a".repeat(130)).endsWith("…")).toBe(true);
    expect(shortenDescription("  shkurt  ")).toBe("shkurt");
  });
});
