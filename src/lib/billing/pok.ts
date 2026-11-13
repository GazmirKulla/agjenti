/** POK Payments REST client. Keys stay on the server; the browser only ever
 * receives an order id or the payerAuthentication object. */

export type PokEnvironment = "staging" | "production";

export type PokOrder = {
  id: string;
  amount?: number;
  originalAmount?: number;
  currencyCode?: string;
  originalCurrencyCode?: string;
  isCompleted?: boolean;
  isCanceled?: boolean;
  isRefunded?: boolean;
  merchantCustomReference?: string | null;
  expiresAt?: string;
};

export type PokPayerAuthentication = {
  deviceDataCollection: { url: string; accessToken: string };
  creditDebitCard: { id: string };
  payerAuthSetupReferenceId: string;
};

export class PokError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type PokConfig = { environment: PokEnvironment; baseUrl: string; merchantId: string; keyId: string; keySecret: string };

export function pokEnvironment(): PokEnvironment {
  return process.env.POK_ENV === "production" ? "production" : "staging";
}

export function pokConfigured() {
  return Boolean(process.env.POK_MERCHANT_ID && process.env.POK_KEY_ID && process.env.POK_KEY_SECRET);
}

function config(): PokConfig {
  const { POK_MERCHANT_ID: merchantId, POK_KEY_ID: keyId, POK_KEY_SECRET: keySecret } = process.env;
  if (!merchantId || !keyId || !keySecret) throw new PokError("POK nuk është konfiguruar.", 503);
  const environment = pokEnvironment();
  const baseUrl = environment === "production" ? "https://api.pokpay.io" : "https://api-staging.pokpay.io";
  return { environment, baseUrl, merchantId, keyId, keySecret };
}

let cachedToken: { value: string; expiresAt: number; environment: PokEnvironment } | null = null;

async function call<T>(cfg: PokConfig, path: string, init: { method: "GET" | "POST"; body?: unknown; token?: string }): Promise<T> {
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; message?: string } | null;
  if (!response.ok || !payload?.data) {
    // The message is POK's own description; it never contains our keys.
    console.error("[pok]", init.method, path.replace(/[0-9a-f-]{36}/g, ":id"), response.status, payload?.message);
    throw new PokError("Pagesa me POK nuk u krye. Provo përsëri.", response.status >= 500 || !response.status ? 502 : response.status);
  }
  return payload.data;
}

async function accessToken(cfg: PokConfig) {
  if (cachedToken && cachedToken.environment === cfg.environment && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.value;
  const data = await call<{ accessToken: string; expiresAt?: string; expiresIn?: string | number }>(cfg, "/auth/sdk/login", {
    method: "POST",
    body: { keyId: cfg.keyId, keySecret: cfg.keySecret },
  });
  const expiresAt = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + Number(data.expiresIn ?? 600_000);
  cachedToken = { value: data.accessToken, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 600_000, environment: cfg.environment };
  return cachedToken.value;
}

async function authorized<T>(path: string, method: "GET" | "POST", body?: unknown) {
  const cfg = config();
  const resolved = path.replace(":merchantId", encodeURIComponent(cfg.merchantId));
  return call<T>(cfg, resolved, { method, body, token: await accessToken(cfg) });
}

/** Card details the browser's AddCardForm produced, forwarded unchanged. */
export async function tokenizeCard(cardPayload: unknown) {
  const data = await authorized<{ creditDebitCard: { id: string; hiddenNumber?: string } }>(
    "/credit-debit-cards/tokenize-guest-card", "POST", cardPayload);
  return data.creditDebitCard;
}

export async function cardLabel(cardId: string, fallbackNumber?: string) {
  try {
    const data = await authorized<{ cards: Array<{ label?: string; brand?: string; number?: string }> }>(
      "/credit-debit-cards/get-guest-cards-information", "POST", { cardIds: [cardId] });
    const card = data.cards?.[0];
    if (card?.label) return card.label;
  } catch {
    // Only the label is missing; the card itself is saved.
  }
  const last4 = fallbackNumber?.replace(/\D/g, "").slice(-4);
  return last4 ? `Karta •••• ${last4}` : "Karta e ruajtur";
}

export async function createOrder(input: { amount: number; currencyCode: string; description: string; reference: string; webhookUrl?: string }) {
  const data = await authorized<{ sdkOrder: PokOrder }>("/merchants/:merchantId/sdk-orders", "POST", {
    amount: input.amount,
    currencyCode: input.currencyCode,
    autoCapture: true,
    shippingCost: 0,
    description: input.description,
    merchantCustomReference: input.reference,
    expiresAfterMinutes: 30,
    ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
  });
  return data.sdkOrder;
}

/** Merchant-scoped lookup: an order that is not ours cannot be read. */
export async function getOrder(orderId: string) {
  const data = await authorized<{ sdkOrder: PokOrder }>(`/merchants/:merchantId/sdk-orders/${encodeURIComponent(orderId)}`, "GET");
  return data.sdkOrder;
}

export async function setupSavedCard3ds(cardId: string, orderId: string) {
  const data = await authorized<{ payerAuthentication: PokPayerAuthentication }>(
    `/credit-debit-cards/${encodeURIComponent(cardId)}/setup-tokenized-3ds`, "POST", { sdkOrder: { id: orderId } });
  return data.payerAuthentication;
}
