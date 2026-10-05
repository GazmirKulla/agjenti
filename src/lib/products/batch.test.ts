import { describe, expect, it } from "vitest";
import { batchSummary, parseProductBatch } from "./batch";

describe("parseProductBatch", () => {
  it("keeps a valid draft and normalizes price and currency", () => {
    expect(
      parseProductBatch([
        {
          name: "  Filizat  ",
          price: "1.490",
          currency: "lekë",
          imageUrl: "javascript:alert(1)",
          externalId: "ig:123",
          description: "140 faqe",
          sku: "FIL-2",
        },
      ]),
    ).toEqual({
      skipped: 0,
      items: [
        {
          name: "Filizat",
          price: 1490,
          currency: "ALL",
          imageUrl: null,
          externalId: "ig:123",
          description: "140 faqe",
          sku: "FIL-2",
        },
      ],
    });
  });

  it("skips a repeated Instagram post and a bad external id", () => {
    const parsed = parseProductBatch([
      { name: "Bluza", price: 10, externalId: "ig:1" },
      { name: "Bluza e dytë", price: 12, externalId: "ig:1" },
      { name: "Tjetër", price: 8, externalId: "zana:1" },
    ]);
    expect(parsed).toMatchObject({
      skipped: 2,
      items: [{ name: "Bluza", externalId: "ig:1" }],
    });
  });

  it("rejects an empty selection and an oversized list", () => {
    expect(parseProductBatch([])).toEqual({ error: "Zgjidh të paktën një produkt." });
    expect(parseProductBatch([{ name: "A" }])).toEqual({
      error: "Asnjë rresht nuk kishte emër të vlefshëm.",
    });
    expect(parseProductBatch(Array.from({ length: 101 }, () => ({ name: "Bluza", price: 1 })))).toEqual({
      error: "Mund të ruhen deri në 100 produkte njëherësh.",
    });
  });
});

describe("batchSummary", () => {
  it("counts created, updated, and skipped rows", () => {
    expect(batchSummary(1, 0, 0)).toBe("U shtua 1 produkt.");
    expect(batchSummary(2, 1, 3)).toBe(
      "U shtuan 2 produkte. 1 produkt nga Instagram u përditësua. 3 rreshta u lanë jashtë.",
    );
  });
});
