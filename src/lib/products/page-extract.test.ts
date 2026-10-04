import { describe, expect, it } from "vitest";
import {
  discoverPublicCatalog,
  draftFromRecord,
  extractProductFromHtml,
  isAppShell,
  parseAmount,
  productSlugFromUrl,
} from "./page-extract";

function jwt(payload: object) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature1`;
}

describe("parseAmount", () => {
  it("reads plain, decimal, and grouped amounts", () => {
    expect(parseAmount(1490)).toBe(1490);
    expect(parseAmount("790")).toBe(790);
    expect(parseAmount("1.490")).toBe(1490);
    expect(parseAmount("1,490.00")).toBe(1490);
    expect(parseAmount("1.490,00")).toBe(1490);
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("extractProductFromHtml", () => {
  it("reads schema.org product data", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">
        {"@graph":[{"@type":"Product","name":"Bluzë","description":"<p>Pambuk</p>","sku":"B-1","image":["https://cdn.example.com/b.jpg"],"offers":{"@type":"Offer","price":"18.50","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}]}
      </script>
      </head><body><h1>Tjetër</h1></body></html>`;
    expect(
      extractProductFromHtml(html, "https://shop.example/products/bluza"),
    ).toMatchObject({
      name: "Bluzë",
      description: "Pambuk",
      price: 18.5,
      currency: "EUR",
      imageUrl: "https://cdn.example.com/b.jpg",
      sku: "B-1",
    });
  });

  it("prefers the sale price marked on the page", () => {
    const html = `<!doctype html><body>
      <h1>Set krijues</h1>
      <p class="price"><del>1.490 Lekë</del> <ins>790 Lekë</ins></p>
      <p>Transporti 200 Lekë</p>
    </body>`;
    expect(extractProductFromHtml(html, "https://shop.example/p/set")).toMatchObject({
      name: "Set krijues",
      price: 790,
      currency: "ALL",
    });
  });

  it("reads an embedded product and ignores a wrapping page object", () => {
    const html = `<!doctype html><body><div id="root"></div>
      <script type="application/json">
        {"layout":{"name":"Home","price":1,"product":{"slug":"bluza","name":"Bluzë","description":"Pambuk","price":1800,"currency":"ALL","image":"https://cdn.example.com/b.jpg"}}}
      </script>
    </body>`;
    expect(extractProductFromHtml(html, "https://shop.example/product/bluza")).toMatchObject({
      name: "Bluzë",
      description: "Pambuk",
      price: 1800,
      currency: "ALL",
      imageUrl: "https://cdn.example.com/b.jpg",
    });
  });

  it("does not treat an empty app shell title as the product", () => {
    const html = `<!doctype html><html><head>
      <title>Filiz Studio — Fletë pune edukative</title>
      <meta property="og:title" content="Filiz Studio — Fletë pune edukative">
      </head><body><div id="root"></div>
      <script type="module" src="/assets/index.js"></script>
    </body></html>`;
    expect(isAppShell(html)).toBe(true);
    expect(extractProductFromHtml(html, "https://www.filiz-studio.com/product/fleteza-kreative-4-5")).toBeNull();
  });
});

describe("draftFromRecord", () => {
  const row = {
    name_sq: "Filizat – Hapi 2 (4-5 vjeç)",
    name_en: "worksheets",
    description_sq: "Rreshti 1\n\nRreshti 2",
    price: 1490,
    discount_type: "fixed",
    discount_value: 700,
    discount_start: null,
    discount_end: null,
    images: ["https://cdn.example.com/a.jpg"],
    slug: "fleteza-kreative-4-5",
  };

  it("uses the Albanian fields and the active sale price", () => {
    expect(draftFromRecord(row, new Date("2026-10-04T00:00:00Z"))).toMatchObject({
      name: "Filizat – Hapi 2 (4-5 vjeç)",
      description: "Rreshti 1\n\nRreshti 2",
      price: 790,
      currency: null,
      imageUrl: "https://cdn.example.com/a.jpg",
      sku: "fleteza-kreative-4-5",
    });
  });

  it("keeps the base price when the discount window has ended", () => {
    expect(
      draftFromRecord(
        { ...row, discount_end: "2000-01-01T00:00:00Z" },
        new Date("2026-10-04T00:00:00Z"),
      )?.price,
    ).toBe(1490);
  });

  it("applies a percentage discount", () => {
    expect(
      draftFromRecord(
        { ...row, price: 1000, discount_type: "percentage", discount_value: 10 },
        new Date("2026-10-04T00:00:00Z"),
      )?.price,
    ).toBe(900);
  });
});

describe("discoverPublicCatalog", () => {
  const ref = "abcdefghijklmnopqrst";
  const anon = jwt({ role: "anon", ref });
  const service = jwt({ role: "service_role", ref });

  it("reads an anon catalog and ignores a service key", () => {
    const source = `
      const url = "https://${ref}.supabase.co";
      const serviceKey = "${service}";
      const anonKey = "${anon}";
      se.from("users").select("*").eq("id", id);
      se.from("products").select(cols).eq("is_active", true).order("created_at");
      se.from("products").select(cols).eq("slug", id);
    `;
    expect(discoverPublicCatalog(source)).toEqual({
      origin: `https://${ref}.supabase.co`,
      apiKey: anon,
      table: "products",
      slugColumn: "slug",
    });
  });

  it("returns nothing when the only key is privileged", () => {
    const source = `
      "https://${ref}.supabase.co"
      "${service}"
      se.from("products").eq("slug", id)
    `;
    expect(discoverPublicCatalog(source)).toBeNull();
  });
});

describe("productSlugFromUrl", () => {
  it("uses the last path segment", () => {
    expect(
      productSlugFromUrl(new URL("https://www.filiz-studio.com/product/fleteza-kreative-4-5")),
    ).toBe("fleteza-kreative-4-5");
  });
});
