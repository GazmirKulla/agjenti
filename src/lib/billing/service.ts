import { createServiceSupabase } from "@/lib/supabase/service";
import { cache } from "react";

export type BillingPlan = "free" | "starter" | "professional" | "enterprise";

export type BillingUsage = {
  plan: BillingPlan;
  limit: number;
  used: number;
  reserved: number;
  extra: number;
  extraReserved: number;
  available: number;
  periodStart: string;
  periodEnd: string;
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
    plan: value.plan as BillingPlan,
    limit: Number(value.limit),
    used: Number(value.used),
    reserved: Number(value.reserved),
    extra: Number(value.extra),
    extraReserved: Number(value.extraReserved),
    available: Number(value.available),
    periodStart: String(value.periodStart),
    periodEnd: String(value.periodEnd),
  };
});

export function billingState(usage: BillingUsage) {
  const counted = usage.used + usage.reserved;
  const monthlyRemaining = Math.max(0, usage.limit - counted);
  const percentage = usage.limit ? Math.min(100, Math.round((counted / usage.limit) * 100)) : 0;
  const exhausted = usage.available === 0;
  const level = exhausted ? "exhausted" : percentage >= 95 ? "urgent" : percentage >= 80 ? "warning" : "normal";
  return { counted, monthlyRemaining, percentage, exhausted, level };
}
