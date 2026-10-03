import { randomBytes } from "node:crypto";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";

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

function integrationKind(catalogSource: string): "zana" | "http" {
  return catalogSource === "zana" ? "zana" : "http";
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

async function loadIntegrationRow(businessId: string, catalogSource: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("integrations")
    .select("catalog_url,orders_url,secret_ciphertext,kind")
    .eq("business_id", businessId)
    .eq("kind", integrationKind(catalogSource))
    .maybeSingle();
  if (error) throw new Error("Nuk u lexua lidhja e katalogut.");
  return data;
}

export async function fetchLinkedCatalog(
  businessId: string,
): Promise<ExternalCatalogProduct[]> {
  const supabase = createServiceSupabase();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("catalog_source")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError || !business)
    throw new Error("Nuk u lexua konfigurimi i katalogut.");
  if (business.catalog_source === "internal") return [];
  const integration = await loadIntegrationRow(
    businessId,
    business.catalog_source,
  );
  const configuredUrl = integration?.catalog_url?.trim() || null;
  if (!configuredUrl) {
    throw new Error(
      "Katalogu i jashtëm nuk është konfiguruar. Vendos URL-në e plotë te Cilësimet.",
    );
  }
  const url = parseAbsoluteUrl(configuredUrl);
  if (!url) {
    throw new Error(
      "URL-ja e katalogut nuk është e vlefshme. Vendos një adresë të plotë te Cilësimet.",
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
    });
  } catch {
    throw new Error(
      "Katalogu i jashtëm nuk përgjigjet. Produktet lokale mbeten të disponueshme.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Katalogu i jashtëm ktheu gabimin ${response.status}. Kontrollo lidhjen te Cilësimet.`,
    );
  const json = (await response.json().catch(() => null)) as {
    products?: ExternalCatalogProduct[];
  } | null;
  if (!json || !Array.isArray(json.products))
    throw new Error("Përgjigjja e katalogut nuk ka formatin e pritur.");
  return json.products.filter(
    (product) =>
      product &&
      typeof product.id === "string" &&
      typeof product.name === "string",
  );
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
  catalogSource?: string | null;
  catalogUrl?: string | null;
  ordersUrl?: string | null;
  apiSecret?: string | null;
}): Promise<CatalogProbeResult> {
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
  const supabase = createServiceSupabase();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("catalog_source")
    .eq("id", params.businessId)
    .maybeSingle();
  if (businessError || !business) {
    return { ...empty, error: "Nuk u lexua konfigurimi i katalogut." };
  }
  const catalogSource = (
    params.catalogSource?.trim() ||
    business.catalog_source
  ).toLowerCase();
  if (catalogSource === "internal") {
    return {
      ...empty,
      ok: true,
      error: "Burimi është katalog manual — nuk ka API për të testuar.",
    };
  }
  let integration: Awaited<ReturnType<typeof loadIntegrationRow>> = null;
  try {
    integration = await loadIntegrationRow(params.businessId, catalogSource);
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
        "Katalogu i jashtëm nuk është konfiguruar. Vendos URL-në e plotë te Cilësimet.",
    };
  }
  const url = parseAbsoluteUrl(configuredCatalog);
  if (!url) {
    return {
      ...empty,
      ordersUrl: configuredOrders,
      error:
        "URL-ja e katalogut nuk është e vlefshme. Vendos një adresë të plotë te Cilësimet.",
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
        "Mungon API key. Gjenero një kod te Cilësimet dhe vendose si AGJENTI_APP_SECRET te sajti i biznesit.",
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

export async function submitExternalOrder(params: {
  businessId: string;
  payload: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  orderId?: string;
  orderNumber?: number;
  error?: string;
}> {
  const supabase = createServiceSupabase();
  const { data: business } = await supabase
    .from("businesses")
    .select("catalog_source")
    .eq("id", params.businessId)
    .maybeSingle();
  const catalogSource = business?.catalog_source ?? "internal";
  const integration = await loadIntegrationRow(
    params.businessId,
    catalogSource,
  ).catch(() => null);
  const url = integration?.orders_url?.trim() || null;
  if (!url || !parseAbsoluteUrl(url)) {
    return { ok: false, error: "Biznesi nuk ka API porosie të konfiguruar." };
  }

  const secret = resolveBearerSecret({
    secretCiphertext: integration?.secret_ciphertext,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(params.payload),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    orderId?: string;
    orderNumber?: number;
    error?: string;
    reason?: string;
  } | null;
  if (!response.ok || !json?.ok) {
    await supabase.from("integration_logs").insert({
      business_id: params.businessId,
      direction: "outbound",
      target: "orders",
      status: "failed",
      error: json?.error || json?.reason || `HTTP ${response.status}`,
    });
    return {
      ok: false,
      error: json?.error || json?.reason || "Porosia e jashtme dështoi.",
    };
  }
  await supabase.from("integration_logs").insert({
    business_id: params.businessId,
    direction: "outbound",
    target: "orders",
    status: "ok",
    error: null,
  });
  return { ok: true, orderId: json.orderId, orderNumber: json.orderNumber };
}

export async function loadBusinessApiSecret(
  businessId: string,
  catalogSource: string,
): Promise<string | null> {
  const integration = await loadIntegrationRow(businessId, catalogSource);
  return (
    resolveBearerSecret({
      secretCiphertext: integration?.secret_ciphertext,
    }) ?? null
  );
}

export async function loadBusinessCatalogUrl(
  businessId: string,
  catalogSource: string,
): Promise<string | null> {
  const integration = await loadIntegrationRow(businessId, catalogSource);
  const url = integration?.catalog_url?.trim() || null;
  return url && parseAbsoluteUrl(url) ? url : null;
}
