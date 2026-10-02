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
  const isZana = business.catalog_source === "zana";
  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("catalog_url,kind")
    .eq("business_id", businessId)
    .eq("kind", isZana ? "zana" : "http")
    .maybeSingle();
  if (integrationError) throw new Error("Nuk u lexua lidhja e katalogut.");
  const base = process.env.ZANA_API_BASE_URL?.trim().replace(/\/$/, "");
  const configuredUrl =
    integration?.catalog_url?.trim() ||
    (isZana && base ? `${base}/api/integrations/agjenti/catalog` : null);
  if (!configuredUrl)
    throw new Error(
      "Katalogu i jashtëm nuk është konfiguruar. Vendos URL-në e plotë te Cilësimet.",
    );
  let url: URL;
  try {
    url = new URL(configuredUrl, isZana && base ? base : undefined);
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Invalid protocol");
  } catch {
    throw new Error(
      "URL-ja e katalogut nuk është e vlefshme. Vendos një adresë të plotë te Cilësimet.",
    );
  }
  // Never send the shared Zana credential to an unrelated catalog endpoint.
  let trustedZanaOrigin = false;
  if (isZana && base) {
    try {
      trustedZanaOrigin = new URL(base).origin === url.origin;
    } catch {
      /* Unconfigured origin. */
    }
  }
  const secret = trustedZanaOrigin
    ? process.env.ZANA_AGJENTI_SECRET?.trim()
    : undefined;
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
  const { data: integration } = await supabase
    .from("integrations")
    .select("orders_url")
    .eq("business_id", params.businessId)
    .maybeSingle();
  const url =
    integration?.orders_url ||
    (business?.catalog_source === "zana"
      ? `${process.env.ZANA_API_BASE_URL?.replace(/\/$/, "")}/api/integrations/agjenti/orders`
      : null);
  if (!url) return { ok: false, error: "Biznesi nuk ka API porosie." };

  const secret = process.env.ZANA_AGJENTI_SECRET?.trim();
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
