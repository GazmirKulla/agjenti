import { expect, it } from "vitest";
import { optionsFromHtml, optionsFromJson } from "./page-options";
import { matchPageOptions } from "@/lib/items/field-suggest";

const script = (type: string, data: unknown) => `<script type="${type}">${JSON.stringify(data)}</script>`;

it("reads colours and sizes from Next.js page data, preferring this product over related ones", () => {
  const html = script("application/json", { props: { pageProps: {
    initialRelated: [{ slug: "tjeter", variants: [{ colorName: "SHINY METAL" }] }],
    initialProduct: { slug: "topolino-15220", variants: [
      { colorName: "RED", colorHex: "#c72323", sizes: [] },
      { colorName: "BLUE", sizes: ["S", { name: "M", stock: 2 }] },
      { colorName: "red" },
    ] },
  } } });
  expect(optionsFromHtml(html, "https://iprint.al/product/topolino-15220")).toEqual([
    { name: "Ngjyra", values: ["RED", "BLUE"] }, { name: "Madhësia", values: ["S", "M"] }]);
});
it("reads schema.org product group variants", () => {
  const html = script("application/ld+json", { "@type": "ProductGroup", url: "https://x.al/p/kemishe",
    hasVariant: [{ color: "E bardhë", size: "M" }, { color: "E zezë", size: { name: "L" } }] });
  expect(optionsFromHtml(html, "https://x.al/p/kemishe")).toEqual([
    { name: "Ngjyra", values: ["E bardhë", "E zezë"] }, { name: "Madhësia", values: ["M", "L"] }]);
});
it("reads WooCommerce variations and Shopify product JSON", () => {
  const variations = JSON.stringify([{ attributes: { attribute_pa_color: "kuqe", attribute_material: "pambuk" } }, { attributes: { attribute_pa_color: "blu" } }]).replace(/"/g, "&quot;");
  expect(optionsFromHtml(`<form data-product_variations="${variations}"></form>`, "https://x.al/produkt/a")).toEqual([
    { name: "Ngjyra", values: ["kuqe", "blu"] }, { name: "Material", values: ["pambuk"] }]);
  expect(optionsFromJson({ product: { title: "Bluzë", options: [{ name: "Size", values: ["S", "M"] }, { name: "Stofi" }],
    variants: [{ option1: "S", option2: "Liri" }, { option1: "Default Title" }] } })).toEqual([
    { name: "Madhësia", values: ["S", "M"] }, { name: "Stofi", values: ["Liri"] }]);
});
it("finds nothing on a page without structured choices", () => {
  expect(optionsFromHtml("<p>3 ngjyra</p>", "https://x.al/p/a")).toEqual([]);
});
it("puts page choices into the business's matching fields and reports the rest", () => {
  const fields = [{ key: "ngjyra", label: "Ngjyra", type: "select" as const, variant: true }];
  expect(matchPageOptions([{ name: "Ngjyra", values: ["RED"] }, { name: "Madhësia", values: ["M"] }], fields)).toEqual({
    filled: { ngjyra: ["RED"] }, unmatched: [{ name: "Madhësia", values: ["M"] }] });
});
