/** The choices a product page offers (colours, sizes…), read from the data
 * the page already carries: schema.org variants, a framework's page data
 * (e.g. Next.js), Shopify product JSON and WooCommerce variations. Only
 * structured data is read, never guessed from prose. */

export type ProductOption = { name: string; values: string[] };

const MAX_OPTIONS = 4;
const MAX_VALUES = 40;

/** Common attribute names, in the words the product form uses. */
const COLOR = /^(?:colou?r(?:_?name)?|ngjyra|pa_colou?r|attribute_pa_colou?r|attribute_colou?r)$/i;
const SIZE = /^(?:size(?:_?name)?|sizes|madh[eë]sia|pa_size|attribute_pa_size|attribute_size)$/i;

function label(key: string): string | null {
  if (COLOR.test(key)) return "Ngjyra";
  if (SIZE.test(key)) return "Madhësia";
  return null;
}

class Collector {
  private options = new Map<string, { name: string; values: Map<string, string> }>();
  add(name: string, raw: unknown) {
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
    const value = text.replace(/\s+/g, " ").trim().slice(0, 60);
    const cleanName = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!value || !cleanName || /^(default title|default|-|n\/a)$/i.test(value)) return;
    const id = cleanName.toLocaleLowerCase("sq");
    let option = this.options.get(id);
    if (!option) {
      if (this.options.size >= MAX_OPTIONS) return;
      option = { name: cleanName, values: new Map() };
      this.options.set(id, option);
    }
    const valueId = value.toLocaleLowerCase("sq");
    if (!option.values.has(valueId) && option.values.size < MAX_VALUES) option.values.set(valueId, value);
  }
  get size() { return this.options.size; }
  list(): ProductOption[] {
    return [...this.options.values()].map(o => ({ name: o.name, values: [...o.values.values()] })).filter(o => o.values.length > 0);
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** A size list may hold strings or objects such as { name: "M", stock: 3 }. */
function sizeValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.map(item => record(item) ? (record(item)!.name ?? record(item)!.label ?? record(item)!.size ?? record(item)!.value) : item);
}

/** Reads one variant object: colour and size keys, Shopify option1..3, WooCommerce attributes. */
function readVariant(variant: Record<string, unknown>, out: Collector, optionNames: string[]) {
  for (const [key, value] of Object.entries(variant)) {
    const name = label(key);
    if (name) for (const item of sizeValues(value)) out.add(name, item);
    const shopify = /^option([123])$/.exec(key);
    if (shopify && optionNames[Number(shopify[1]) - 1]) out.add(optionNames[Number(shopify[1]) - 1], value);
  }
  const attributes = record(variant.attributes);
  if (attributes) for (const [key, value] of Object.entries(attributes)) out.add(label(key) ?? prettyAttribute(key), value);
}

function prettyAttribute(key: string): string {
  const text = key.replace(/^attribute_(?:pa_)?/i, "").replace(/[_-]+/g, " ").trim();
  return text ? text[0].toLocaleUpperCase("sq") + text.slice(1) : key;
}

/** A product object: its option list (Shopify style) and its variants. */
function readProductObject(product: Record<string, unknown>, out: Collector) {
  const optionNames: string[] = [];
  if (Array.isArray(product.options)) for (const option of product.options) {
    const row = record(option);
    const name = typeof option === "string" ? option : typeof row?.name === "string" ? row.name : null;
    if (!name) continue;
    optionNames.push(name);
    if (Array.isArray(row?.values)) for (const value of row.values) out.add(label(name) ?? name, value);
  }
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    const row = record(variant);
    if (row) readVariant(row, out, optionNames.map(n => label(n) ?? n));
  }
  // schema.org ProductGroup
  for (const variant of Array.isArray(product.hasVariant) ? product.hasVariant : []) {
    const row = record(variant);
    if (!row) continue;
    if (row.color) out.add("Ngjyra", row.color);
    if (row.size) out.add("Madhësia", record(row.size)?.name ?? row.size);
  }
}

/** Finds product objects in parsed JSON: ones with variants that mention the page's slug, else the first with variants. */
function productObjects(value: unknown, slug: string | null): Record<string, unknown>[] {
  const all: Record<string, unknown>[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || all.length > 50) return;
    if (Array.isArray(node)) { for (const item of node.slice(0, 200)) visit(item, depth + 1); return; }
    const row = record(node);
    if (!row) return;
    if (Array.isArray(row.variants) || Array.isArray(row.hasVariant)) all.push(row);
    for (const child of Object.values(row)) if (typeof child === "object") visit(child, depth + 1);
  };
  visit(value, 0);
  if (!slug) return all.slice(0, 1);
  const wanted = slug.toLowerCase();
  const mentions = all.filter(row => ["slug", "handle", "url", "path", "href", "@id"].some(k => typeof row[k] === "string" && (row[k] as string).toLowerCase().includes(wanted)));
  return mentions.length ? mentions : all.slice(0, 1);
}

function decodeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function slugOf(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    return url.searchParams.get("slug") || url.searchParams.get("handle") || url.pathname.split("/").filter(Boolean).at(-1) || null;
  } catch { return null; }
}

/** The options a product page offers, from its embedded structured data. */
export function optionsFromHtml(html: string, pageUrl: string): ProductOption[] {
  const slug = slugOf(pageUrl);
  const out = new Collector();
  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const block of blocks) {
    if (block.length > 1_500_000) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(block); } catch { continue; }
    for (const product of productObjects(parsed, slug)) readProductObject(product, out);
    if (out.size) return out.list();
  }
  // WooCommerce variable products.
  const woo = /data-product_variations=(["'])([\s\S]*?)\1/i.exec(html);
  if (woo) {
    try {
      const variations = JSON.parse(decodeAttribute(woo[2]));
      if (Array.isArray(variations)) for (const variation of variations) { const row = record(variation); if (row) readVariant(row, out, []); }
    } catch { /* not JSON: no options */ }
  }
  return out.list();
}

/** The options of a product read as JSON (a Shopify product.js or a catalog record). */
export function optionsFromJson(value: unknown): ProductOption[] {
  const out = new Collector();
  for (const product of productObjects(value, null)) readProductObject(product, out);
  return out.list();
}
