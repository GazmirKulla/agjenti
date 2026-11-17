import { randomBytes } from "node:crypto";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isIsolatedExecution, refuseIsolatedEffect, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";

export type ExternalCatalogProduct = {
  id: string;
  name: string;
  productType: string | null;
  price: number | null;
  currency?: string;
  formats?: Array<{ id: string; name: string; price: number | null }>;
  colors?: Array<{ id: string; name: string }>;
};

export function generateIntegrationSecret(): string {
  return randomBytes(32).toString("hex");
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function resolveBearerSecret(params: {
  secretCiphertext?: string | null;
  apiSecretOverride?: string | null;
}): string | undefined {
  const override = params.apiSecretOverride?.trim();
  if (override) return override;
  if (params.secretCiphertext) {
    try {
      return decryptSecret(params.secretCiphertext);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Derive knowledge endpoint from a full catalog URL when possible. */
export function knowledgeUrlFromCatalog(catalogUrl: string): string | null {
  const url = parseAbsoluteUrl(catalogUrl);
  if (!url) return null;
  if (url.pathname.endsWith("/catalog")) {
    url.pathname = `${url.pathname.slice(0, -"/catalog".length)}/knowledge`;
    return url.toString();
  }
  return null;
}

async function loadIntegrationRow(businessId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("integrations")
    .select("catalog_url,orders_url,secret_ciphertext,kind")
    .eq("business_id", businessId)
    .eq("kind", "http")
    .maybeSingle();
  if (error) throw new Error("Nuk u lexua lidhja e katalogut.");
  return data;
}

/** True when the business has a catalog API URL configured. */
export async function isExternalCatalogLinked(
  businessId: string,
): Promise<boolean> {
  const integration = await loadIntegrationRow(businessId).catch(() => null);
  const url = integration?.catalog_url?.trim() || null;
  return Boolean(url && parseAbsoluteUrl(url));
}

/** The website catalog as sent: products keep every field (contract v1 or v2). */
export async function fetchLinkedCatalogDocument(
  businessId: string,
): Promise<{ currency: string | null; products: Array<ExternalCatalogProduct & Record<string, unknown>> }> {
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "external_catalog");
  const integration = await loadIntegrationRow(businessId);
  const configuredUrl = integration?.catalog_url?.trim() || null;
  if (!configuredUrl) return { currency: null, products: [] };
  const url = parseAbsoluteUrl(configuredUrl);
  if (!url) {
    throw new Error(
      "URL-ja e katalogut nuk është e vlefshme. Vendos një adresë të plotë te Integrimet.",
    );
  }
  const secret = resolveBearerSecret({
    secretCiphertext: integration?.secret_ciphertext,
  });
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Katalogu i jashtëm nuk përgjigjet. Produktet lokale mbeten të disponueshme.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Katalogu i jashtëm ktheu gabimin ${response.status}. Kontrollo lidhjen te Integrimet.`,
    );
  const json = (await response.json().catch(() => null)) as {
    currency?: unknown;
    products?: Array<ExternalCatalogProduct & Record<string, unknown>>;
  } | null;
  if (!json || !Array.isArray(json.products))
    throw new Error("Përgjigjja e katalogut nuk ka formatin e pritur.");
  return {
    currency: typeof json.currency === "string" ? json.currency : null,
    products: json.products.filter(
      (product) =>
        product &&
        typeof product.id === "string" &&
        typeof product.name === "string",
    ),
  };
}

export async function fetchLinkedCatalog(
  businessId: string,
): Promise<ExternalCatalogProduct[]> {
  return (await fetchLinkedCatalogDocument(businessId)).products;
}

export type CatalogProbeResult = {
  ok: boolean;
  url: string | null;
  ordersUrl: string | null;
  httpStatus: number | null;
  authSent: boolean;
  error: string | null;
  productCount: number;
  products: Array<{
    id: string;
    name: string;
    productType: string | null;
    price: number | null;
    currency?: string;
    formatCount: number;
    colorCount: number;
  }>;
  productTypeCount: number | null;
  formatCount: number | null;
};

export async function probeLinkedCatalog(params: {
  businessId: string;
  catalogUrl?: string | null;
  ordersUrl?: string | null;
  apiSecret?: string | null;
}): Promise<CatalogProbeResult> {
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "catalog_probe");
  const empty: CatalogProbeResult = {
    ok: false,
    url: null,
    ordersUrl: null,
    httpStatus: null,
    authSent: false,
    error: null,
    productCount: 0,
    products: [],
    productTypeCount: null,
    formatCount: null,
  };
  let integration: Awaited<ReturnType<typeof loadIntegrationRow>> = null;
  try {
    integration = await loadIntegrationRow(params.businessId);
  } catch {
    return { ...empty, error: "Nuk u lexua lidhja e katalogut." };
  }
  const configuredCatalog =
    params.catalogUrl?.trim() || integration?.catalog_url?.trim() || null;
  const configuredOrders =
    params.ordersUrl?.trim() || integration?.orders_url?.trim() || null;
  if (!configuredCatalog) {
    return {
      ...empty,
      ordersUrl: configuredOrders,
      error:
        "Katalogu i jashtëm nuk është konfiguruar. Vendos URL-në e plotë te Integrimet.",
    };
  }
  const url = parseAbsoluteUrl(configuredCatalog);
  if (!url) {
    return {
      ...empty,
      ordersUrl: configuredOrders,
      error:
        "URL-ja e katalogut nuk është e vlefshme. Vendos një adresë të plotë te Integrimet.",
    };
  }
  const secret = resolveBearerSecret({
    secretCiphertext: integration?.secret_ciphertext,
    apiSecretOverride: params.apiSecret,
  });
  const authSent = Boolean(secret);
  if (!authSent) {
    return {
      ...empty,
      url: url.toString(),
      ordersUrl: configuredOrders,
      authSent: false,
      error:
        "Mungon API key. Gjenero një kod te Integrimet dhe vendose si AGJENTI_APP_SECRET te sajti i biznesit.",
    };
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    return {
      ...empty,
      url: url.toString(),
      ordersUrl: configuredOrders,
      authSent,
      error: "Katalogu i jashtëm nuk përgjigjet.",
    };
  }
  const json = (await response.json().catch(() => null)) as {
    products?: ExternalCatalogProduct[];
    productTypes?: unknown[];
    formats?: unknown[];
    error?: string;
  } | null;
  if (!response.ok) {
    const baseError =
      json?.error ||
      `Katalogu i jashtëm ktheu gabimin ${response.status}.`;
    return {
      ...empty,
      url: url.toString(),
      ordersUrl: configuredOrders,
      httpStatus: response.status,
      authSent,
      error:
        response.status === 401
          ? `${baseError} API key te Agjenti duhet të jetë i njëjtë me AGJENTI_APP_SECRET te sajti.`
          : baseError,
    };
  }
  if (!json || !Array.isArray(json.products)) {
    return {
      ...empty,
      url: url.toString(),
      ordersUrl: configuredOrders,
      httpStatus: response.status,
      authSent,
      error: "Përgjigjja e katalogut nuk ka formatin e pritur (mungon products[]).",
    };
  }
  const products = json.products
    .filter(
      (product) =>
        product &&
        typeof product.id === "string" &&
        typeof product.name === "string",
    )
    .map((product) => ({
      id: product.id,
      name: product.name,
      productType: product.productType ?? null,
      price: product.price ?? null,
      currency: product.currency,
      formatCount: Array.isArray(product.formats) ? product.formats.length : 0,
      colorCount: Array.isArray(product.colors) ? product.colors.length : 0,
    }));
  return {
    ok: true,
    url: url.toString(),
    ordersUrl: configuredOrders,
    httpStatus: response.status,
    authSent,
    error: null,
    productCount: products.length,
    products: products.slice(0, 12),
    productTypeCount: Array.isArray(json.productTypes)
      ? json.productTypes.length
      : null,
    formatCount: Array.isArray(json.formats) ? json.formats.length : null,
  };
}

export type ExternalOrderResult = {
  status: "local_only" | "accepted" | "rejected" | "pending_reconciliation";
  ok: boolean;
  skipped?: boolean;
  orderId?: string;
  error?: string;
  /** The website's own error code (e.g. price_changed), when it gave a safe one. */
  code?: string;
  /** The field the website named with the code (e.g. character, customer.address). */
  field?: string;
  /** The item (from 1) the refusal belongs to, when the website named one. */
  item?: number;
  /** On success: what the customer pays on the website (items plus shipping) and the shipping. */
  total?: number;
  shipping?: number;
};

export async function submitExternalOrder(params: {
  businessId: string;
  /** Correlation only. The current HTTP contract does NOT guarantee idempotent delivery. */
  attemptId: string;
  payload: Record<string, unknown>;
}): Promise<ExternalOrderResult> {
  assertBusinessEffectAllowed("provider.order");
  if (isIsolatedExecution()) refuseIsolatedEffect("order.create", "external_provider");
  const supabase = createServiceSupabase();
  let result: ExternalOrderResult;
  const unknown = (): ExternalOrderResult => ({ status: "pending_reconciliation", ok: false,
    error: "Dërgimi nuk u verifikua. Stafi duhet ta kontrollojë te sistemi i jashtëm; mos e ridërgo." });
  try {
    const integration = await loadIntegrationRow(params.businessId);
    const url = integration?.orders_url?.trim();
    // A failed configuration read is NOT evidence that there is no integration.
    if (!url) return { status: "local_only", ok: true, skipped: true };
    if (!parseAbsoluteUrl(url)) return unknown();
    const secret = resolveBearerSecret({ secretCiphertext: integration?.secret_ciphertext });
    if (integration?.secret_ciphertext && !secret) return unknown();
    const response = await fetch(url, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", "X-Agjenti-Submission-Id": params.attemptId,
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(params.payload), signal: AbortSignal.timeout(20_000),
    });
    const json = await response.json().catch(() => null) as { ok?: unknown; orderId?: unknown; error?: unknown; reason?: unknown; field?: unknown; item?: unknown; total?: unknown; shipping?: unknown } | null;
    // Zana sends {reason: "missing_field", error: "missing_field", field: "character"}; the code wins over a sentence.
    const code = [json?.reason, json?.error].find((v): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(v));
    const field = typeof json?.field === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(json.field) ? json.field : undefined;
    const item = typeof json?.item === "number" && Number.isInteger(json.item) && json.item >= 1 && json.item <= 20 ? json.item : undefined;
    const amount = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9_999_999_999 ? v : undefined);
    if (response.ok && json?.ok === true) {
      const total = amount(json.total), shipping = amount(json.shipping);
      result = { status: "accepted", ok: true, orderId: typeof json.orderId === "string" ? json.orderId.slice(0, 200) : undefined,
        ...(total !== undefined ? { total } : {}), ...(shipping !== undefined ? { shipping } : {}) };
    } else if (json?.ok === false && (response.ok || response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)
      // Contract v2: price_changed is answered before anything is created.
      || response.status === 409 && code === "price_changed")) {
      result = { status: "rejected", ok: false, error: "Sistemi i jashtëm e refuzoi porosinë. Kërkohet shqyrtim nga stafi.", ...(code ? { code } : {}), ...(code && field ? { field } : {}), ...(code && item ? { item } : {}) };
    } else result = unknown();
  } catch {
    // Timeouts/network errors can occur AFTER the provider committed the order.
    result = unknown();
  }
  // Logging must not erase a verified provider response; the submission ledger is authoritative.
  try {
    await supabase.from("integration_logs").insert({ business_id: params.businessId,
      direction: "outbound", target: "orders", status: result.ok ? "ok" : "failed", error: result.code ? (result.field ? `${result.code}:${result.field}` : result.code) : result.error ?? null });
  } catch { /* Ledger persistence is checked by the caller. Never retry delivery for a log failure. */ }
  return result;
}

export async function loadBusinessApiSecret(
  businessId: string,
): Promise<string | null> {
  const integration = await loadIntegrationRow(businessId);
  return (
    resolveBearerSecret({
      secretCiphertext: integration?.secret_ciphertext,
    }) ?? null
  );
}

export async function loadBusinessCatalogUrl(
  businessId: string,
): Promise<string | null> {
  const integration = await loadIntegrationRow(businessId);
  const url = integration?.catalog_url?.trim() || null;
  return url && parseAbsoluteUrl(url) ? url : null;
}


/** A file of an item on the business website: the customer's (input) or the store's (output, e.g. processed design). */
export type ExternalOrderFile = { key: string; role: "input" | "output"; url: string };
/** A status of the website's own order workflow, as its staff name it. */
export type ExternalOrderStatus = { key: string; label: string };
export type ExternalOrderView = {
  orderNumber?: number; status: string; total?: number; shipping?: number;
  /** The website's name for `status`, and every status it uses (newer websites; absent otherwise). */
  statusLabel?: string; statuses?: ExternalOrderStatus[];
  /** Whether the website still accepts a change of this order; absent when the website does not say. */
  editable?: boolean;
  items: { item: number; productName: string | null; files: ExternalOrderFile[] }[];
};

/** The order's address on the website: {orders_url}/{id}, only for an https URL and a safe id. */
async function externalOrderUrl(businessId: string, externalOrderId: string, suffix = ""): Promise<{ url: string; secret?: string } | null> {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(externalOrderId)) return null;
  const integration = await loadIntegrationRow(businessId);
  const base = integration?.orders_url?.trim();
  const parsed = base ? parseAbsoluteUrl(base) : null;
  if (!parsed || parsed.protocol !== "https:") return null;
  const secret = resolveBearerSecret({ secretCiphertext: integration?.secret_ciphertext });
  return { url: `${parsed.toString().replace(/\/$/, "")}/${encodeURIComponent(externalOrderId)}${suffix}`, ...(secret ? { secret } : {}) };
}

function readView(json: unknown): ExternalOrderView | null {
  const j = json as { ok?: unknown; orderNumber?: unknown; status?: unknown; statusLabel?: unknown; statuses?: unknown; total?: unknown; shipping?: unknown; editable?: unknown; items?: unknown } | null;
  if (!j || j.ok !== true || !Array.isArray(j.items)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const items = j.items.slice(0, 20).flatMap((raw, index) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as { item?: unknown; productName?: unknown; files?: unknown };
    const files = (Array.isArray(item.files) ? item.files : []).flatMap((f) => {
      const file = (f && typeof f === "object" ? f : {}) as { key?: unknown; role?: unknown; url?: unknown };
      return typeof file.key === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(file.key) && typeof file.url === "string" && file.url.startsWith("https://") && file.url.length < 2000
        ? [{ key: file.key, role: file.role === "output" ? "output" as const : "input" as const, url: file.url }] : [];
    }).slice(0, 100);
    return [{ item: num(item.item) ?? index + 1, productName: typeof item.productName === "string" ? item.productName.slice(0, 200) : null, files }];
  });
  return { ...(num(j.orderNumber) !== undefined ? { orderNumber: num(j.orderNumber) } : {}), status: typeof j.status === "string" ? j.status.slice(0, 40) : "",
    ...(num(j.total) !== undefined ? { total: num(j.total) } : {}), ...(num(j.shipping) !== undefined ? { shipping: num(j.shipping) } : {}),
    ...(typeof j.editable === "boolean" ? { editable: j.editable } : {}),
    ...(typeof j.statusLabel === "string" && j.statusLabel.trim() ? { statusLabel: j.statusLabel.trim().slice(0, 80) } : {}),
    ...(Array.isArray(j.statuses) ? { statuses: readStatuses(j.statuses) } : {}), items };
}

/** The website's statuses: a safe key and a name each, at most 30, no key twice. */
export function readStatuses(raw: unknown[]): ExternalOrderStatus[] {
  const seen = new Set<string>();
  return raw.slice(0, 30).flatMap((entry) => {
    const s = (entry && typeof entry === "object" ? entry : {}) as { key?: unknown; label?: unknown };
    if (typeof s.key !== "string" || !STATUS_KEY.test(s.key) || seen.has(s.key)) return [];
    seen.add(s.key);
    const label = typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, 80) : s.key;
    return [{ key: s.key, label }];
  });
}
/** A website status key: short, letters, digits, "_" and "-". */
export const STATUS_KEY = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Moves an order on the business website to another of its statuses: POST {orders_url}/{id}/status.
 * Only the website's answer counts: accepted with the order as it now is, refused with its reason,
 * or not known (timeout, server error), when nothing is assumed.
 */
export async function changeExternalOrderStatus(businessId: string, externalOrderId: string, status: string): Promise<
  { ok: true; view: ExternalOrderView } | { ok: false; uncertain?: boolean; code?: string }> {
  assertBusinessEffectAllowed("provider.order");
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "external_order_status");
  if (!STATUS_KEY.test(status)) return { ok: false, code: "invalid_status" };
  const target = await externalOrderUrl(businessId, externalOrderId, "/status");
  if (!target) return { ok: false, code: "integration_unavailable" };
  const response = await fetch(target.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", ...(target.secret ? { Authorization: `Bearer ${target.secret}` } : {}) },
    body: JSON.stringify({ status }) }).catch(() => null);
  const json = await response?.json().catch(() => null) as { reason?: unknown; error?: unknown } | null;
  const view = response?.ok ? readView(json) : null;
  const code = [json?.reason, json?.error].find((v): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(v));
  try {
    await createServiceSupabase().from("integration_logs").insert({ business_id: businessId, direction: "outbound", target: "order_status",
      status: view ? "ok" : "failed", error: view ? null : code ?? `http_${response?.status ?? 0}` });
  } catch { /* the website's answer stands */ }
  if (view) return { ok: true, view };
  // No answer or a server error: the website may have applied it; it tells or is read again.
  if (!response || response.status >= 500) return { ok: false, uncertain: true };
  return { ok: false, ...(code ? { code } : {}) };
}

/** Reads an order on the business website, with each item's photos. Read only; null when it cannot be read. */
export async function fetchExternalOrder(businessId: string, externalOrderId: string): Promise<ExternalOrderView | null> {
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "external_order_read");
  const target = await externalOrderUrl(businessId, externalOrderId);
  if (!target) return null;
  const response = await fetch(target.url, { headers: target.secret ? { Authorization: `Bearer ${target.secret}` } : {}, redirect: "manual",
    signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return readView(await response.json().catch(() => null));
}

/**
 * Adds the store's photos (processed design, finished product) to an order on the website. Each file
 * carries Agjenti's id, so a repeated delivery adds nothing twice. The website keeps the files.
 */
export async function sendExternalOrderFiles(businessId: string, externalOrderId: string,
  groups: { item: number; key: string; files: { id: string; url: string }[] }[]): Promise<{ ok: true; view: ExternalOrderView } | { ok: false; code?: string; field?: string }> {
  assertBusinessEffectAllowed("provider.order");
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "external_order_files");
  const target = await externalOrderUrl(businessId, externalOrderId, "/files");
  if (!target) return { ok: false, code: "integration_unavailable" };
  const response = await fetch(target.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", ...(target.secret ? { Authorization: `Bearer ${target.secret}` } : {}) },
    body: JSON.stringify({ items: groups }) }).catch(() => null);
  const json = await response?.json().catch(() => null) as { reason?: unknown; error?: unknown; field?: unknown } | null;
  const view = response?.ok ? readView(json) : null;
  try {
    await createServiceSupabase().from("integration_logs").insert({ business_id: businessId, direction: "outbound", target: "order_files",
      status: view ? "ok" : "failed", error: view ? null : typeof json?.reason === "string" ? json.reason.slice(0, 60) : `http_${response?.status ?? 0}` });
  } catch { /* the website's answer stands */ }
  if (view) return { ok: true, view };
  const code = [json?.reason, json?.error].find((v): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(v));
  return { ok: false, ...(code ? { code } : {}), ...(typeof json?.field === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(json.field) ? { field: json.field } : {}) };
}

/** The website's answer to a change: accepted, refused (nothing changed), or not known. */
export type ExternalOrderChange =
  | { status: "accepted"; view: ExternalOrderView | null }
  | { status: "rejected"; code?: string; field?: string }
  | { status: "uncertain" };

/**
 * Changes an order on the business website: PATCH {orders_url}/{id} with the delivery details and/or the
 * note. X-Agjenti-Change-Id identifies the change: the website applies one id once and answers the same
 * again, so sending the same change again after an unclear result is safe. A timeout or a server error
 * is "uncertain", never a refusal: the website may have applied it.
 */
export async function amendExternalOrder(businessId: string, externalOrderId: string, changeId: string,
  changes: Record<string, unknown>): Promise<ExternalOrderChange> {
  assertBusinessEffectAllowed("provider.order");
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "external_order_change");
  const target = await externalOrderUrl(businessId, externalOrderId);
  if (!target) return { status: "rejected", code: "integration_unavailable" };
  let result: ExternalOrderChange;
  try {
    const response = await fetch(target.url, { method: "PATCH", redirect: "manual", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", "X-Agjenti-Change-Id": changeId, ...(target.secret ? { Authorization: `Bearer ${target.secret}` } : {}) },
      body: JSON.stringify({ version: 2, changes }) });
    const json = await response.json().catch(() => null) as { ok?: unknown; reason?: unknown; error?: unknown; field?: unknown } | null;
    const code = [json?.reason, json?.error].find((v): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(v));
    const field = typeof json?.field === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(json.field) ? json.field : undefined;
    if (response.ok && json?.ok === true) result = { status: "accepted", view: readView(json) };
    // A website without the change route answers 404/405: nothing changed.
    else if (response.status === 404 || response.status === 405) result = { status: "rejected", code: code ?? "change_unsupported" };
    else if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) && json?.ok === false)
      result = { status: "rejected", ...(code ? { code } : {}), ...(code && field ? { field } : {}) };
    else result = { status: "uncertain" };
  } catch {
    result = { status: "uncertain" };
  }
  try {
    await createServiceSupabase().from("integration_logs").insert({ business_id: businessId, direction: "outbound", target: "order_change",
      status: result.status === "accepted" ? "ok" : "failed", error: result.status === "rejected" ? result.code ?? "rejected" : result.status === "uncertain" ? "uncertain" : null });
  } catch { /* the website's answer stands */ }
  return result;
}
