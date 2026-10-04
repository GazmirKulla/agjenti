import { describe, expect, it, vi } from "vitest";
import { importProductFromUrl } from "./import-url";

function jwt(payload: object) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature1`;
}

function htmlResponse(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

const resolvePublic = async () => ["1.1.1.1"];

describe("importProductFromUrl", () => {
  it("fills a product from a normal product page without reading scripts", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(`<!doctype html><head>
        <script type="application/ld+json">
          {"@type":"Product","name":"Bluzë","description":"Pambuk","offers":{"price":"18.50","priceCurrency":"EUR"}}
        </script>
        <script src="/assets/app.js"></script>
      </head><body><h1>Bluzë</h1><p>${"Pambuk i butë. ".repeat(20)}</p></body>`),
    );
    const result = await importProductFromUrl("https://shop.example/products/bluza", {
      fetch: fetchMock,
      resolveHost: resolvePublic,
    });
    expect(result).toMatchObject({
      product: { name: "Bluzë", price: 18.5, currency: "EUR", description: "Pambuk" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a javascript storefront from its public catalog", async () => {
    const ref = "abcdefghijklmnopqrst";
    const anon = jwt({ role: "anon", ref });
    const shell = `<!doctype html><html><head><title>Dyqani — Kreu</title></head>
      <body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;
    const script = `
      const url = "https://${ref}.supabase.co";
      const key = "${anon}";
      db.from("products").select(cols).eq("slug", id);
    `;
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/product/fleteza-kreative-4-5")) return htmlResponse(shell);
      if (url.endsWith("/assets/index.js")) {
        return new Response(script, { headers: { "content-type": "application/javascript" } });
      }
      if (url.includes(`${ref}.supabase.co/rest/v1/products`)) {
        const headers = new Headers(init?.headers);
        expect(headers.get("apikey")).toBe(anon);
        expect(url).toContain("slug=eq.fleteza-kreative-4-5");
        return Response.json([
          {
            name_sq: "Filizat – Hapi 2 (4-5 vjeç)",
            name_en: "worksheets",
            description_sq: "Paketë me 140 faqe.",
            price: 1490,
            discount_type: "fixed",
            discount_value: 700,
            images: ["https://cdn.example.com/a.jpg"],
            slug: "fleteza-kreative-4-5",
          },
        ]);
      }
      return new Response("missing", { status: 404 });
    });

    const result = await importProductFromUrl(
      "https://www.filiz-studio.com/product/fleteza-kreative-4-5",
      { fetch: fetchMock, resolveHost: resolvePublic, now: new Date("2026-10-04T00:00:00Z") },
    );
    expect(result).toMatchObject({
      product: {
        name: "Filizat – Hapi 2 (4-5 vjeç)",
        description: "Paketë me 140 faqe.",
        price: 790,
        imageUrl: "https://cdn.example.com/a.jpg",
        sku: "fleteza-kreative-4-5",
      },
    });
    if ("note" in result) {
      expect(result.note).toContain("Nuk ruhet");
    }
    expect(seen.some((url) => url.includes("127.0.0.1"))).toBe(false);
  });

  it("reads a Shopify product json endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/products/shirt.js")) {
        return Response.json({
          title: "Shirt",
          body_html: "<p>Soft cotton</p>",
          handle: "shirt",
          variants: [{ price: "19.00", sku: "SH-1", available: true }],
          images: [{ src: "https://cdn.shopify.com/shirt.jpg" }],
        });
      }
      return htmlResponse(
        `<!doctype html><body><h1>Shirt</h1><p>${"Cotton shirt for summer. ".repeat(12)}</p></body>`,
      );
    });
    const result = await importProductFromUrl("https://shop.example/products/shirt", {
      fetch: fetchMock,
      resolveHost: resolvePublic,
    });
    expect(result).toMatchObject({
      product: {
        name: "Shirt",
        description: "Soft cotton",
        price: 19,
        sku: "SH-1",
        imageUrl: "https://cdn.shopify.com/shirt.jpg",
      },
    });
  });

  it("refuses private and local addresses before fetching", async () => {
    const fetchMock = vi.fn();
    await expect(
      importProductFromUrl("http://127.0.0.1/admin", {
        fetch: fetchMock,
        resolveHost: resolvePublic,
      }),
    ).resolves.toEqual({ error: "Ky link nuk mund të lexohet." });
    await expect(
      importProductFromUrl("https://shop.example/p", {
        fetch: fetchMock,
        resolveHost: async () => ["10.0.0.8"],
      }),
    ).resolves.toEqual({ error: "Ky link nuk mund të lexohet." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect into a private address", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).not.toContain("127.0.0.1");
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      });
    });
    await expect(
      importProductFromUrl("https://shop.example/go", {
        fetch: fetchMock,
        resolveHost: resolvePublic,
      }),
    ).resolves.toEqual({ error: "Ky link nuk mund të lexohet." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for a real product link when the page has no product", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse("<!doctype html><body><div id='root'></div><script src='/app.js'></script></body>"),
    );
    const result = await importProductFromUrl("https://shop.example/", {
      fetch: fetchMock,
      resolveHost: resolvePublic,
    });
    expect(result).toEqual({
      error:
        "Nuk gjeta emrin e produktit në këtë faqe. Kontrollo linkun, ose plotësoje dorazi.",
    });
  });
});
