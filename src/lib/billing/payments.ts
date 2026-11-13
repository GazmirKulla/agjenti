import { createServiceSupabase } from "@/lib/supabase/service";
import { plans, type BillingPlan } from "./service";
import { cardLabel, createOrder, getOrder, PokError, pokEnvironment, setupSavedCard3ds, tokenizeCard, type PokOrder } from "./pok";

export const PAYMENT_CURRENCY = "ALL";
export type PaidPlan = Exclude<BillingPlan, "free">;
export type PaymentStatus = "pending" | "paid" | "failed";
type PaymentRow = { id: string; user_id: string; plan: PaidPlan; amount: number | string; currency: string; environment: string; pok_order_id: string | null; status: PaymentStatus };

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "starter" || value === "professional" || value === "enterprise";
}

export class BillingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** What a POK order means for our payment. Only an order POK reports as
 * completed, for exactly our amount, currency and reference, counts as paid. */
export function orderOutcome(payment: { id: string; amount: number; currency: string }, order: PokOrder, now = Date.now()): PaymentStatus {
  const amount = Number(order.originalAmount ?? order.amount);
  const currency = order.originalCurrencyCode ?? order.currencyCode;
  const matches = amount === payment.amount && currency === payment.currency
    && (order.merchantCustomReference == null || order.merchantCustomReference === payment.id);
  if (order.isCompleted === true && !order.isRefunded && !order.isCanceled) return matches ? "paid" : "failed";
  if (order.isCanceled || order.isRefunded) return "failed";
  if (order.expiresAt && Date.parse(order.expiresAt) < now) return "failed";
  return "pending";
}

function validCardPayload(value: unknown): value is { csFlexCard: { jwe: string }; billingInfo: Record<string, unknown>; securityCode: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const flex = v.csFlexCard as Record<string, unknown> | undefined;
  return typeof flex?.jwe === "string" && flex.jwe.length > 0 && flex.jwe.length < 20_000
    && !!v.billingInfo && typeof v.billingInfo === "object"
    && typeof v.securityCode === "string" && /^\d{3,4}$/.test(v.securityCode);
}

export async function loadPaymentCard(userId: string) {
  const { data } = await createServiceSupabase().from("account_payment_cards").select("label,environment,pok_card_id").eq("user_id", userId).maybeSingle();
  // A staging card cannot pay in production and the other way around.
  return data && data.environment === pokEnvironment() ? { label: data.label as string, cardId: data.pok_card_id as string } : null;
}

export async function savePaymentCard(userId: string, payload: unknown) {
  if (!validCardPayload(payload)) throw new BillingError("Të dhënat e kartës nuk janë të plota.");
  const card = await tokenizeCard(payload);
  if (!card?.id) throw new BillingError("Karta nuk u ruajt. Provo përsëri.", 502);
  const label = await cardLabel(card.id, card.hiddenNumber);
  const { error } = await createServiceSupabase().from("account_payment_cards").upsert(
    { user_id: userId, pok_card_id: card.id, label, environment: pokEnvironment(), created_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new BillingError("Karta nuk u ruajt. Provo përsëri.", 500);
  return { label };
}

export async function removePaymentCard(userId: string) {
  const { error } = await createServiceSupabase().from("account_payment_cards").delete().eq("user_id", userId);
  if (error) throw new BillingError("Karta nuk u hoq. Provo përsëri.", 500);
}

function webhookUrl(paymentId: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base?.startsWith("https://")) return undefined;
  return `${base.replace(/\/$/, "")}/api/webhooks/pok?payment=${paymentId}`;
}

/** Creates the POK order for one month of the plan and prepares 3-D Secure for
 * the saved card. The browser then finishes the payment with usePOK. */
export async function startPlanPayment(userId: string, plan: PaidPlan) {
  const card = await loadPaymentCard(userId);
  if (!card) throw new BillingError("Shto një kartë para pagesës.");
  const amount = plans[plan].monthlyPrice;
  const db = createServiceSupabase();
  const { data: payment, error } = await db.from("billing_payments")
    .insert({ user_id: userId, plan, amount, currency: PAYMENT_CURRENCY, environment: pokEnvironment() })
    .select("id").single();
  if (error || !payment) throw new BillingError("Pagesa nuk u nis. Provo përsëri.", 500);
  try {
    const order = await createOrder({
      amount,
      currencyCode: PAYMENT_CURRENCY,
      description: `Agjenti — paketa ${plans[plan].name}, 1 muaj`,
      reference: payment.id,
      webhookUrl: webhookUrl(payment.id),
    });
    await db.from("billing_payments").update({ pok_order_id: order.id }).eq("id", payment.id);
    const payerAuthentication = await setupSavedCard3ds(card.cardId, order.id);
    return { paymentId: payment.id as string, orderId: order.id, payerAuthentication };
  } catch (cause) {
    await db.from("billing_payments").update({ status: "failed" }).eq("id", payment.id);
    throw cause instanceof PokError ? new BillingError(cause.message, cause.status) : cause;
  }
}

/** Asks POK for the order's real state and records it. Neither the browser nor
 * the webhook body is trusted; both only trigger this check. */
export async function syncPlanPayment(paymentId: string, userId?: string): Promise<PaymentStatus> {
  const db = createServiceSupabase();
  let query = db.from("billing_payments").select("id,user_id,plan,amount,currency,environment,pok_order_id,status").eq("id", paymentId);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.maybeSingle();
  const payment = data as PaymentRow | null;
  if (!payment) throw new BillingError("Pagesa nuk u gjet.", 404);
  if (payment.status !== "pending" || !payment.pok_order_id) return payment.status;
  if (payment.environment !== pokEnvironment()) return "pending";
  const order = await getOrder(payment.pok_order_id);
  const outcome = orderOutcome({ id: payment.id, amount: Number(payment.amount), currency: payment.currency }, order);
  if (outcome === "paid") {
    const { error } = await db.rpc("apply_billing_payment", { p_payment: payment.id });
    if (error) {
      console.error("[billing] apply payment", error.message);
      throw new BillingError("Pagesa u krye, por paketa nuk u përditësua ende. Rifresko faqen pas pak.", 500);
    }
  } else if (outcome === "failed") {
    if (order.isCompleted) console.error("[billing] completed POK order does not match payment", payment.id);
    await db.from("billing_payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "pending");
  }
  return outcome;
}
