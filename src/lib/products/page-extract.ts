export type ProductDraft = {
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  sku: string | null;
};

export type PublicCatalog = {
  origin: string;
  apiKey: string;
  table: string;
  slugColumn: "slug" | "handle";
};

const PREFERRED_TABLES = new Set(["product", "products"]);

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) return null;
    return roundMoney(value);
  }
  if (typeof value !== "string" || value.trim().startsWith("-")) return null;
  let text = value.trim().replace(/[\s\u00a0]/g, "");
  if (!text) return null;
  text = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(text)) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text =
      comma > dot
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? "," : ".";
    const parts = text.split(sep);
    if (parts.length > 2) text = parts.join("");
    else if ((parts[1] ?? "").length === 3) text = parts.join("");
    else text = `${parts[0]}.${parts[1] ?? ""}`;
  }

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return null;
  return roundMoney(amount);
}

export function productSlugFromUrl(url: URL): string | null {
  const query = url.searchParams.get("slug") || url.searchParams.get("handle");
  const raw = decodeURIComponent(
    query || url.pathname.split("/").filter(Boolean).at(-1) || "",
  ).trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._~-]{0,159}$/u.test(raw)) return null;
  return raw;
}

export function isAppShell(html: string): boolean {
  const mount = html.match(
    /<div\b[^>]*\bid=["'](?:root|app|__next)["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!mount) return false;
  const inner = mount[1].replace(/<!--[\s\S]*?-->/g, "").trim();
  if (inner.length > 0) return false;
  return visibleText(html).length < 80;
}

export function extractProductFromHtml(
  html: string,
  pageUrl: string,
): ProductDraft | null {
  const structured = mergeDraft([
    fromJsonLd(html, pageUrl),
    fromEmbeddedJson(html, pageUrl),
  ]);
  if (isAppShell(html)) return structured;
  return mergeDraft([
    structured,
    fromMicrodata(html, pageUrl),
    fromVisible(html),
    fromOpenGraph(html, pageUrl),
  ]);
}

export function draftFromRecord(
  row: Record<string, unknown>,
  now = new Date(),
): ProductDraft | null {
  const name = cleanName(pickText(row, ["name", "title", "product_name"]) ?? "");
  if (!name) return null;
  const description =
    cleanCopy(pickText(row, ["description", "body", "content", "summary"]) ?? "") ??
    cleanCopy(pickText(row, ["tagline"]) ?? "");
  return {
    name,
    description,
    price: priceOf(row, now),
    currency: currencyCode(firstString(row, ["currency", "currency_code", "price_currency"])),
    imageUrl: firstImage(row),
    sku: cleanSku(row.sku) ?? cleanSku(row.slug) ?? cleanSku(row.handle),
  };
}

export function draftFromShopify(data: unknown): Partial<ProductDraft> | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const product = (
    root.product && typeof root.product === "object" ? root.product : root
  ) as Record<string, unknown>;
  if (typeof product.title !== "string") return null;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant =
    variants.find(
      (item) =>
        !!item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).available !== false,
    ) ?? variants[0];
  const variantRow =
    variant && typeof variant === "object"
      ? (variant as Record<string, unknown>)
      : null;
  return {
    name: product.title,
    description:
      typeof product.body_html === "string"
        ? product.body_html
        : typeof product.description === "string"
          ? product.description
          : null,
    price: parseAmount(variantRow?.price),
    currency: currencyCode(
      typeof product.currency === "string" ? product.currency : null,
    ),
    imageUrl: firstImage({ images: product.images, image: product.image }),
    sku: cleanSku(variantRow?.sku) ?? cleanSku(product.handle),
  };
}

export function discoverPublicCatalog(source: string): PublicCatalog | null {
  const table = findProductTable(source);
  if (!table) return null;
  const originMatch = source.match(/https:\/\/([a-z0-9]{16,30})\.supabase\.co\b/i);
  if (!originMatch) return null;
  const ref = originMatch[1].toLowerCase();
  const apiKey = findAnonKey(source, ref);
  if (!apiKey) return null;
  return {
    origin: `https://${ref}.supabase.co`,
    apiKey,
    table: table.table,
    slugColumn: table.slugColumn,
  };
}

export function mergeDraft(
  parts: Array<Partial<ProductDraft> | null | undefined>,
): ProductDraft | null {
  const name = parts.map((part) => cleanName(part?.name ?? "")).find(Boolean);
  if (!name) return null;
  const description =
    parts
      .map((part) => (part?.description ? cleanCopy(part.description) : null))
      .find(Boolean) ?? null;
  const price =
    parts
      .map((part) => part?.price)
      .find((value) => value != null && value >= 0) ?? null;
  const currency =
    parts
      .map((part) => part?.currency ?? null)
      .find((code) => !!code && /^[A-Z]{3}$/.test(code)) ?? null;
  const imageUrl =
    parts
      .map((part) => part?.imageUrl ?? null)
      .find((url) => !!url && absoluteHttp(url) === url) ?? null;
  const sku = parts.map((part) => cleanSku(part?.sku)).find(Boolean) ?? null;
  return { name, description, price, currency, imageUrl, sku };
}

function fromJsonLd(html: string, pageUrl: string): Partial<ProductDraft> | null {
  const nodes: Record<string, unknown>[] = [];
  for (const block of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      collectObjects(JSON.parse(block[1]), nodes, 0);
    } catch {
      continue;
    }
  }
  const products = nodes.filter(isProductNode);
  const slug = safeSlug(pageUrl);
  const ranked = products
    .map((node) => ({
      node,
      score:
        (slug && JSON.stringify(node).toLowerCase().includes(slug.toLowerCase()) ? 5 : 0) +
        (readOffer(node.offers).price != null ? 2 : 0) +
        (typeof node.name === "string" ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const node = ranked[0]?.node;
  if (!node) return null;
  const offer = readOffer(node.offers);
  const name = typeof node.name === "string" ? node.name : "";
  return {
    name,
    description: typeof node.description === "string" ? node.description : null,
    price: offer.price,
    currency: offer.currency,
    imageUrl: imageFrom(node.image, pageUrl),
    sku: cleanSku(node.sku) ?? cleanSku(node.productID),
  };
}

function fromEmbeddedJson(html: string, pageUrl: string): Partial<ProductDraft> | null {
  const slug = safeSlug(pageUrl);
  if (!slug) return null;
  let best: ProductDraft | null = null;
  for (const block of html.matchAll(
    /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (block[1].length > 500_000) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    walkRecords(parsed, (row) => {
      if (best || !rowMentionsSlug(row, slug)) return;
      const draft = draftFromRecord(row);
      if (draft?.name && draft.price != null) best = draft;
    });
    if (best) return best;
  }
  return best;
}

function fromMicrodata(html: string, pageUrl: string): Partial<ProductDraft> | null {
  const name = itemprop(html, "name");
  const price = parseAmount(itemprop(html, "price"));
  const currency = currencyCode(itemprop(html, "priceCurrency"));
  const description = itemprop(html, "description");
  const image = itemprop(html, "image");
  if (!name && price == null) return null;
  return {
    name: name ?? "",
    description,
    price,
    currency,
    imageUrl: image ? absoluteHttp(image, pageUrl) : null,
    sku: cleanSku(itemprop(html, "sku")),
  };
}

function fromVisible(html: string): Partial<ProductDraft> | null {
  const name = cleanName(firstTagText(html, "h1") ?? "");
  const marked = markedPrice(html);
  const price = marked ?? solePrice(visibleText(html));
  if (!name && !price) return null;
  return {
    name,
    price: price?.amount ?? null,
    currency: price?.currency ?? null,
  };
}

function fromOpenGraph(html: string, pageUrl: string): Partial<ProductDraft> | null {
  const name = readMeta(html, "og:title") || titleText(html);
  const description = readMeta(html, "og:description") || readMeta(html, "description");
  const image = readMeta(html, "og:image");
  const price = parseAmount(
    readMeta(html, "product:price:amount") || readMeta(html, "og:price:amount"),
  );
  const currency = currencyCode(
    readMeta(html, "product:price:currency") || readMeta(html, "og:price:currency"),
  );
  if (!name && price == null && !description) return null;
  return {
    name: name ?? "",
    description,
    price,
    currency,
    imageUrl: image ? absoluteHttp(image, pageUrl) : null,
  };
}

function findProductTable(
  source: string,
): { table: string; slugColumn: "slug" | "handle" } | null {
  const re = /\.from\(\s*["']([A-Za-z_][\w]{0,40})["']\s*\)/g;
  let found: { table: string; slugColumn: "slug" | "handle" } | null = null;
  for (const match of source.matchAll(re)) {
    const table = match[1];
    if (!isProductTable(table)) continue;
    const rest = source.slice(match.index + match[0].length);
    const nextFrom = rest.search(/\.from\(\s*["']/);
    const tail = rest.slice(0, nextFrom >= 0 ? Math.min(nextFrom, 500) : 500);
    const slug = /\.eq\(\s*["']slug["']/.test(tail);
    const handle = /\.eq\(\s*["']handle["']/.test(tail);
    if (!slug && !handle) continue;
    const hit = {
      table,
      slugColumn: slug ? ("slug" as const) : ("handle" as const),
    };
    if (PREFERRED_TABLES.has(table)) return hit;
    found ??= hit;
  }
  return found;
}

function isProductTable(name: string): boolean {
  return PREFERRED_TABLES.has(name) || name.endsWith("_products");
}

function findAnonKey(source: string, ref: string): string | null {
  const tokens =
    source.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g) ??
    [];
  for (const token of tokens) {
    const payload = decodeJwtPayload(token);
    if (!payload || payload.role !== "anon") continue;
    if (payload.ref && payload.ref !== ref) continue;
    return token;
  }
  return null;
}

function decodeJwtPayload(token: string): { role?: string; ref?: string } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const payload = JSON.parse(json) as { role?: unknown; ref?: unknown };
    return {
      role: typeof payload.role === "string" ? payload.role : undefined,
      ref: typeof payload.ref === "string" ? payload.ref : undefined,
    };
  } catch {
    return null;
  }
}

function priceOf(row: Record<string, unknown>, now: Date): number | null {
  const base = parseAmount(
    row.price ?? row.price_amount ?? row.regular_price ?? row.amount,
  );
  const current = parseAmount(row.current_price ?? row.currentPrice ?? row.sale_price);
  if (base == null) return current;
  if (current != null && current < base) return current;
  return applyDiscount(base, row, now);
}

function applyDiscount(price: number, row: Record<string, unknown>, now: Date): number {
  const type = String(row.discount_type ?? row.discountType ?? "").toLowerCase();
  const value = parseAmount(row.discount_value ?? row.discountValue);
  if (value == null || value <= 0 || !discountActive(row, now)) return price;
  let next = price;
  if (type === "percentage" || type === "percent") next = price * (1 - value / 100);
  else if (type === "fixed" || type === "amount" || type === "fixed_amount") next = price - value;
  else return price;
  if (!Number.isFinite(next) || next >= price) return price;
  return roundMoney(Math.max(0, next));
}

function discountActive(row: Record<string, unknown>, now: Date): boolean {
  const start = dateOrNull(row.discount_start ?? row.discountStart);
  const end = dateOrNull(row.discount_end ?? row.discountEnd);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickText(row: Record<string, unknown>, bases: string[]): string | null {
  for (const base of bases) {
    for (const suffix of ["_sq", "_al", "", "_en"]) {
      const value = row[`${base}${suffix}`];
      if (typeof value === "string" && value.trim().length >= 2) return value.trim();
    }
    const nested = row[base];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      for (const key of ["sq", "al", "en"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length >= 2) return value.trim();
      }
    }
  }
  return null;
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return null;
}

function firstImage(row: Record<string, unknown>): string | null {
  for (const key of ["image_url", "image", "thumbnail", "featured_image", "images"]) {
    const found = imageFrom(row[key]);
    if (found) return found;
  }
  return null;
}

function imageFrom(value: unknown, base?: string): string | null {
  if (typeof value === "string") return absoluteHttp(value, base);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageFrom(item, base);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return imageFrom(row.url ?? row.src ?? row.contentUrl, base);
  }
  return null;
}

function readOffer(offers: unknown): { price: number | null; currency: string | null } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  let fallback: { price: number | null; currency: string | null } | null = null;
  for (const offer of list) {
    if (!offer || typeof offer !== "object") continue;
    const row = offer as Record<string, unknown>;
    let price = parseAmount(row.price ?? row.lowPrice);
    let currency = currencyCode(
      typeof row.priceCurrency === "string" ? row.priceCurrency : null,
    );
    if ((price == null || !currency) && row.priceSpecification && typeof row.priceSpecification === "object") {
      const spec = row.priceSpecification as Record<string, unknown>;
      price = price ?? parseAmount(spec.price);
      currency =
        currency ??
        currencyCode(typeof spec.priceCurrency === "string" ? spec.priceCurrency : null);
    }
    if (price == null) continue;
    const hit = { price, currency };
    if (/instock/i.test(String(row.availability ?? ""))) return hit;
    fallback ??= hit;
  }
  return fallback ?? { price: null, currency: null };
}

function isProductNode(node: Record<string, unknown>): boolean {
  const raw = node["@type"];
  const types = (Array.isArray(raw) ? raw : [raw]).filter(
    (item): item is string => typeof item === "string",
  );
  return types.some((type) => {
    const name = type.toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
    return name === "product" || name === "productgroup";
  });
}

function collectObjects(value: unknown, out: Record<string, unknown>[], depth: number) {
  if (depth > 7 || out.length > 100 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  out.push(row);
  for (const key of ["@graph", "mainEntity", "hasVariant", "itemListElement", "item"]) {
    if (key in row) collectObjects(row[key], out, depth + 1);
  }
}

function rowMentionsSlug(row: Record<string, unknown>, slug: string): boolean {
  const wanted = slug.toLowerCase();
  for (const key of ["slug", "handle", "url", "path", "href"]) {
    const value = row[key];
    if (typeof value === "string" && value.toLowerCase().includes(wanted)) return true;
  }
  return false;
}

function walkRecords(value: unknown, visit: (row: Record<string, unknown>) => void) {
  const stack = [value];
  let seen = 0;
  while (stack.length && seen < 1500) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    seen += 1;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const row = current as Record<string, unknown>;
    visit(row);
    for (const child of Object.values(row)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
}

type MoneyHit = { amount: number; currency: string };

const PRICE_RE =
  /(?:(€|\$|£)\s*(\d{1,3}(?:[.\s\u00a0]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))|(?:\b(EUR|USD|ALL|GBP)\s+(\d{1,3}(?:[.\s\u00a0]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?))|(?:(\d{1,3}(?:[.\s\u00a0]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(Lekë|Leke|Lek\b|ALL\b|EUR\b|USD\b|GBP\b|€|\$|£))/giu;

function findPrices(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  for (const match of text.slice(0, 20_000).matchAll(PRICE_RE)) {
    const amount = parseAmount(match[2] || match[4] || match[5] || "");
    const currency = currencyCode(match[1] || match[3] || match[6] || "");
    if (amount == null || !currency) continue;
    hits.push({ amount, currency });
  }
  return hits;
}

function solePrice(text: string): MoneyHit | null {
  const hits = findPrices(text);
  if (!hits.length) return null;
  const first = hits[0];
  if (hits.some((hit) => hit.amount !== first.amount)) return null;
  return first;
}

function markedPrice(html: string): MoneyHit | null {
  for (const block of html.matchAll(/<ins\b[^>]*>([\s\S]{0,400}?)<\/ins>/gi)) {
    const hit = findPrices(htmlToText(block[1]))[0];
    if (hit) return hit;
  }
  for (const marker of html.matchAll(
    /class=["'][^"']*(?:price|cmim|çmim)[^"']*["']/gi,
  )) {
    const slice = htmlToText(html.slice(marker.index ?? 0, (marker.index ?? 0) + 280));
    const hit = findPrices(slice)[0];
    if (hit) return hit;
  }
  return null;
}

function itemprop(html: string, prop: string): string | null {
  const open = html.match(
    new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop=["']${prop}["'][^>]*>`, "i"),
  );
  if (!open) return null;
  const content = open[0].match(/\bcontent=["']([^"']*)["']/i)?.[1];
  if (content) return decodeHtml(content).trim() || null;
  const inner = html.match(
    new RegExp(
      `<${open[1]}\\b[^>]*\\bitemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/${open[1]}>`,
      "i",
    ),
  );
  return inner ? htmlToText(inner[1]) || null : null;
}

function readMeta(html: string, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (attr !== wanted) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content).trim() || null;
  }
  return null;
}

function titleText(html: string): string | null {
  const title = firstTagText(html, "title");
  if (!title) return null;
  const parts = title
    .split(/\s+[|–—-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return title;
  return [...parts].sort((a, b) => b.length - a.length)[0] ?? title;
}

function firstTagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return null;
  const text = htmlToText(match[1]).replace(/\s+/g, " ").trim();
  return text || null;
}

function visibleText(html: string): string {
  const body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  return htmlToText(body);
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanName(value: string): string {
  const text = stripControls(decodeHtml(value)).replace(/\s+/g, " ").trim();
  if (text.length < 2) return "";
  return text.slice(0, 180);
}

function cleanCopy(value: string): string | null {
  const text = stripControls(value.includes("<") ? htmlToText(value) : value)
    .replace(/\r\n/g, "\n")
    .trim();
  if (text.length < 2) return null;
  if (text.length <= 4000) return text;
  return `${text.slice(0, 3999).trimEnd()}…`;
}

function cleanSku(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 80) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))
    return null;
  return text;
}

function currencyCode(token: string | null | undefined): string | null {
  if (!token) return null;
  const text = token.trim().toUpperCase().replaceAll("Ë", "E");
  if (text === "€" || text === "EUR" || text === "EURO") return "EUR";
  if (text === "$" || text === "USD" || text === "US$") return "USD";
  if (text === "£" || text === "GBP") return "GBP";
  if (text === "LEKE" || text === "LEK" || text === "ALL") return "ALL";
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function absoluteHttp(value: string, base?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, base ?? "https://placeholder.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!base && url.hostname === "placeholder.invalid") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeSlug(pageUrl: string): string | null {
  try {
    return productSlugFromUrl(new URL(pageUrl));
  } catch {
    return null;
  }
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, digits: string) => fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)));
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
