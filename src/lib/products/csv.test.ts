import { describe, expect, it } from "vitest";
import { parseProductCsv } from "./csv";

describe("parseProductCsv", () => {
  it("reads Albanian headers, grouped prices, and quoted commas", () => {
    const parsed = parseProductCsv(
      "\uFEFFemri,çmimi,monedha,përshkrimi,sku,foto\n\"Filizat, Hapi 2\",1.490,LEK,140 faqe,FIL-2,https://cdn.example/a.jpg\n",
    );
    expect(parsed).toEqual({
      rows: [
        {
          line: 2,
          name: "Filizat, Hapi 2",
          priceText: "1490",
          currency: "ALL",
          description: "140 faqe",
          sku: "FIL-2",
          imageUrl: "https://cdn.example/a.jpg",
          invalidPrice: false,
        },
      ],
    });
  });

  it("accepts an Excel semicolon file and a price written with Lekë", () => {
    const parsed = parseProductCsv("sep=;\nemri;cmimi\nKarrige;12,50 EUR\n");
    expect(parsed).toMatchObject({
      rows: [{ line: 2, name: "Karrige", priceText: "12.50", currency: "EUR", invalidPrice: false }],
    });
  });

  it("keeps a row with a bad price so it can be corrected", () => {
    const parsed = parseProductCsv("Bluza,abc,ALL\n");
    expect(parsed).toMatchObject({
      rows: [{ line: 1, name: "Bluza", priceText: "abc", invalidPrice: true, currency: "ALL" }],
    });
  });

  it("rejects an empty file, a header-only file, a broken quote, and too many rows", () => {
    expect(parseProductCsv(" \n")).toEqual({ error: "Skedari është bosh." });
    expect(parseProductCsv("emri,cmimi\n")).toEqual({ error: "Skedari ka vetëm titujt e kolonave." });
    expect(parseProductCsv('"Bluza,790')).toEqual({ error: "Skedari CSV ka thonjëza të pahapura." });
    const lines = ["emri,cmimi", ...Array.from({ length: 101 }, (_, index) => `Produkti ${index},10`)];
    expect(parseProductCsv(lines.join("\n"))).toEqual({
      error: "Skedari ka 101 rreshta. Maksimumi është 100.",
    });
  });
});
