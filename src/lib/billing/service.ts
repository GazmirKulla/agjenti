import { createServiceSupabase } from "@/lib/supabase/service";
import { cache } from "react";

export type BillingPlan = "free" | "starter" | "professional" | "enterprise";

export type BillingUsage = {
  /** "account": the billing owner's plan, shared by all their businesses. */
  scope: "account" | "business";
  billingUserId: string | null;
  plan: BillingPlan;
  limit: number;
  used: number;
  reserved: number;
  extra: number;
  extraReserved: number;
  available: number;
  periodStart: string;
  periodEnd: string;
  /** End of the paid time of a plan paid with POK; null for Free or a plan set by an administrator. */
  paidUntil: string | null;
};

export const plans: Record<BillingPlan, { name: string; monthlyLimit: number; monthlyPrice: number }> = {
  free: { name: "Free", monthlyLimit: 1_000, monthlyPrice: 0 },
  starter: { name: "Starter", monthlyLimit: 10_000, monthlyPrice: 1_500 },
  professional: { name: "Professional", monthlyLimit: 50_000, monthlyPrice: 5_000 },
  enterprise: { name: "Enterprise", monthlyLimit: 200_000, monthlyPrice: 8_000 },
};

export const loadBillingUsage = cache(async function loadBillingUsage(businessId: string): Promise<BillingUsage> {
  const { data, error } = await createServiceSupabase().rpc("business_allowance", {
    p_business: businessId,
  });
  if (error || !data) {
    console.error("[billing] allowance", error?.message);
    throw new Error("Nuk u ngarkua përdorimi i paketës.");
  }
  const value = data as Record<string, unknown>;
  return {
    scope: value.scope === "account" ? "account" : "business",
    billingUserId: typeof value.billingUserId === "string" ? value.billingUserId : null,
    plan: value.plan as BillingPlan,
    limit: Number(value.limit),
    used: Number(value.used),
    reserved: Number(value.reserved),
    extra: Number(value.extra),
    extraReserved: Number(value.extraReserved),
    available: Number(value.available),
    periodStart: String(value.periodStart),
    periodEnd: String(value.periodEnd),
    paidUntil: typeof value.paidUntil === "string" ? value.paidUntil : null,
  };
});

/** Messages each of the payer's businesses used in the current period. */
export async function loadUsageBreakdown(billingUserId: string, periodStart: string) {
  const db = createServiceSupabase();
  const { data: businesses, error } = await db.from("businesses").select("id,name,slug").eq("billing_user_id", billingUserId).order("name");
  if (error) throw new Error("Nuk u ngarkua ndarja sipas biznesit.");
  const ids = (businesses ?? []).map((b) => b.id);
  const { data: usage } = ids.length
    ? await db.from("business_usage").select("business_id,used").in("business_id", ids).eq("period_start", periodStart)
    : { data: [] };
  const used = new Map((usage ?? []).map((row) => [row.business_id as string, Number(row.used) || 0]));
  return (businesses ?? []).map((b) => ({ id: b.id as string, name: b.name as string, slug: b.slug as string, used: used.get(b.id) ?? 0 }));
}

/** An assistant reply to the owner counts as one message of the payer's plan.
 * Returns false when the plan has no messages left. */
export async function consumeAssistantMessage(businessId: string): Promise<boolean> {
  const { data, error } = await createServiceSupabase().rpc("consume_assistant_message", { p_business: businessId });
  if (error) {
    console.error("[billing] assistant message", error.message);
    return true;
  }
  return data === true;
}

export function billingState(usage: BillingUsage) {
  const counted = usage.used + usage.reserved;
  const monthlyRemaining = Math.max(0, usage.limit - counted);
  const percentage = usage.limit ? Math.min(100, Math.round((counted / usage.limit) * 100)) : 0;
  const exhausted = usage.available === 0;
  const level = exhausted ? "exhausted" : percentage >= 95 ? "urgent" : percentage >= 80 ? "warning" : "normal";
  return { counted, monthlyRemaining, percentage, exhausted, level };
}
