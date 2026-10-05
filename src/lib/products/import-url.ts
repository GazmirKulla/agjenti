import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  discoverPublicCatalog,
  draftFromRecord,
  draftFromShopify,
  extractProductFromHtml,
  isAppShell,
  mergeDraft,
  productSlugFromUrl,
  type ProductDraft,
} from "./page-extract";

export type ImportResult =
  | { product: ProductDraft; note: string }
  | { error: string };

export type ImportDeps = {
  fetch?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  now?: Date;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Fetched = { url: string; body: string; contentType: string };

export async function importProductFromUrl(
  raw: string,
  deps: ImportDeps = {},
): Promise<ImportResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;
  const now = deps.now ?? new Date();
  try {
    const page = await fetchChecked(raw.trim(), fetchImpl, resolveHost, 1_200_000);
    if ("error" in page) return page;

    const parsedJson = looksLikeJson(page) ? parseJson(page.body) : null;
    if (parsedJson) {
      const draft = draftFromJson(parsedJson, now);
      if (draft?.name) return ready(draft);
    }

    const shell = isAppShell(page.body);
    const htmlDraft = extractProductFromHtml(page.body, page.url);
    if (!shell && htmlDraft?.name && htmlDraft.price != null) return ready(htmlDraft);

    const catalogDraft =
      shell || /supabase\.co/i.test(page.body)
        ? await draftFromPublicCatalog(page, fetchImpl, resolveHost, now)
        : null;
    const shopifyDraft = await draftFromShopifyUrl(page.url, fetchImpl, resolveHost, now);
    const merged = mergeDraft([catalogDraft, shopifyDraft, htmlDraft]);
    if (merged?.name) return ready(merged);
    return {
      error:
        "Nuk gjeta emrin e produktit në këtë faqe. Kontrollo linkun, ose plotësoje dorazi.",
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { error: "Faqja vonoi shumë. Provo përsëri." };
    }
    console.error("[products.import]", name || "error");
    return { error: "Faqja nuk u hap. Kontrollo linkun dhe provo përsëri." };
  }
}

function ready(product: ProductDraft): ImportResult {
  if (product.price == null) {
    return {
      product,
      note: "U lexua emri nga faqja, por jo çmimi. Plotësoje dhe kontrollo të dhënat. Nuk ruhet derisa të klikosh Ruaj produktin.",
    };
  }
  return {
    product,
    note: "U lexua nga faqja. Kontrollo emrin, çmimin dhe përshkrimin. Nuk ruhet derisa të klikosh Ruaj produktin.",
  };
}

function draftFromJson(value: unknown, now: Date): ProductDraft | null {
  const shopify = mergeDraft([draftFromShopify(value)]);
  if (shopify?.name) return shopify;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return draftFromRecord(row as Record<string, unknown>, now);
}

async function draftFromPublicCatalog(
  page: Fetched,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
  now: Date,
): Promise<ProductDraft | null> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(page.url);
  } catch {
    return null;
  }
  const slug = productSlugFromUrl(pageUrl);
  if (!slug) return null;

  let source = inlineScripts(page.body).join("\n");
  let catalog = source ? discoverPublicCatalog(source) : null;
  if (!catalog) {
    for (const src of scriptSrcs(page.body, page.url).slice(0, 3)) {
      const js = await readScript(src, page.url, fetchImpl, resolveHost);
      if (!js) continue;
      source = source ? `${source}\n${js}` : js;
      catalog = discoverPublicCatalog(source);
      if (catalog) break;
    }
  }
  if (!catalog) return null;

  const endpoint = `${catalog.origin}/rest/v1/${catalog.table}?${catalog.slugColumn}=eq.${encodeURIComponent(slug)}&select=*`;
  const fetched = await fetchChecked(endpoint, fetchImpl, resolveHost, 400_000, {
    accept: "application/json",
    apikey: catalog.apiKey,
    authorization: `Bearer ${catalog.apiKey}`,
  });
  if ("error" in fetched) return null;
  const parsed = parseJson(fetched.body);
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return draftFromRecord(row as Record<string, unknown>, now);
}

async function draftFromShopifyUrl(
  pageUrl: string,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
  now: Date,
): Promise<ProductDraft | null> {
  const endpoint = shopifyProductJs(pageUrl);
  if (!endpoint || endpoint === pageUrl) return null;
  const fetched = await fetchChecked(endpoint, fetchImpl, resolveHost, 400_000, {
    accept: "application/json",
  });
  if ("error" in fetched) return null;
  return draftFromJson(parseJson(fetched.body), now);
}

function shopifyProductJs(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "products");
  const handle = parts[index + 1]?.replace(/\.js$/i, "");
  if (index < 0 || !handle || !/^[\w.-]{1,160}$/.test(handle)) return null;
  return `${url.origin}/products/${handle}.js`;
}

function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const type = match[1].match(/\btype=["']([^"']+)["']/i)?.[1] ?? "";
    if (type && !/javascript|ecmascript|module/i.test(type)) continue;
    const body = match[2].trim();
    if (body) out.push(body.slice(0, 400_000));
  }
  return out;
}

function scriptSrcs(html: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  const out: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(match[1], pageUrl);
      if (url.origin !== origin) continue;
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      out.push(url.toString());
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}

async function readScript(
  src: string,
  pageUrl: string,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<string | null> {
  const url = new URL(src, pageUrl);
  if (url.origin !== new URL(pageUrl).origin) return null;
  const fetched = await fetchChecked(url.toString(), fetchImpl, resolveHost, 400_000);
  if ("error" in fetched) return null;
  if (/html|image|audio|video|pdf/i.test(fetched.contentType)) return null;
  return fetched.body;
}

async function fetchChecked(
  raw: string,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
  maxBytes: number,
  headers?: Record<string, string>,
): Promise<Fetched | { error: string }> {
  let current = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    const checked = await assertPublic(current, resolveHost);
    if ("error" in checked) return checked;
    const response = await fetchImpl(checked.url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "sq,en;q=0.8",
        "user-agent": USER_AGENT,
        ...headers,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { error: "Faqja nuk u hap. Kontrollo linkun dhe provo përsëri." };
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (response.status === 404) return { error: "Nuk e gjeta këtë faqe." };
    if (response.status < 200 || response.status >= 300) {
      return { error: "Faqja nuk u hap. Kontrollo linkun dhe provo përsëri." };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (/image\/|audio\/|video\/|application\/pdf|application\/zip|octet-stream/i.test(contentType)) {
      return { error: "Ky link nuk është faqe produkti." };
    }
    const body = await readLimited(response, maxBytes);
    if (typeof body !== "string") return body;
    return { url: checked.url, body, contentType };
  }
  return { error: "Faqja ka shumë përcjellje." };
}

async function assertPublic(
  raw: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<{ url: string } | { error: string }> {
  if (!raw || raw.length > 2000) {
    return raw
      ? { error: "Ky link nuk mund të lexohet." }
      : { error: "Ngjit linkun e produktit." };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Vendos një link të plotë që fillon me http ose https." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Vendos një link të plotë që fillon me http ose https." };
  }
  if (url.username || url.password) return { error: "Ky link nuk mund të lexohet." };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (blockedHostname(host)) return { error: "Ky link nuk mund të lexohet." };
  const addresses = isIP(host) ? [host] : await resolveOrNull(host, resolveHost);
  if (!addresses?.length) return { error: "Nuk e gjeta këtë faqe." };
  if (addresses.some(isBlockedIp)) return { error: "Ky link nuk mund të lexohet." };
  return { url: url.toString() };
}

async function resolveOrNull(
  host: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<string[] | null> {
  try {
    return await resolveHost(host);
  } catch {
    return null;
  }
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return host === "metadata.google.internal";
}

function isBlockedIp(address: string): boolean {
  let ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(ip)) return true;
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<string | { error: string }> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: "Faqja është shumë e madhe për t'u skanuar." };
  }
  if (!response.body) {
    const text = await response.text();
    if (text.length > maxBytes) return { error: "Faqja është shumë e madhe për t'u skanuar." };
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { error: "Faqja është shumë e madhe për t'u skanuar." };
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function looksLikeJson(page: Fetched): boolean {
  return page.contentType.includes("json") || /^\s*[[{]/.test(page.body);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Shared bounded public-page reader for business and catalog ingestion. */
export async function fetchPublicPage(url: string, deps: ImportDeps = {}) {
  return fetchChecked(url, deps.fetch ?? fetch, deps.resolveHost ?? defaultResolveHost, 1_200_000);
}
