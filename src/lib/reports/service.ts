import { createServiceSupabase } from "@/lib/supabase/service";
import type { ReportDay } from "./model";

/** Daily numbers for the last `range` days and the `range` days before them. */
export async function loadBusinessReport(businessId: string, range: number) {
  const { data, error } = await createServiceSupabase().rpc("business_report", { p_business: businessId, p_days: range });
  if (error || !data) throw new Error("Raporti nuk u ngarkua. Provo përsëri.");
  const report = data as { days: ReportDay[]; aiMessagesThisPeriod: number; timezone?: string; generatedAt?: string };
  if (!Array.isArray(report.days) || !report.days.every(day => typeof day.day === "string"
    && [day.inbound, day.aiReplies, day.orders, day.bookings, day.customers].every(n => Number.isSafeInteger(n) && n >= 0)))
    throw new Error("Të dhënat e raportit janë të pavlefshme.");
  // Older deployments must not claim a business timezone that their RPC did not use.
  return { days: report.days, aiMessagesThisPeriod: Number(report.aiMessagesThisPeriod ?? 0),
    timezone: report.timezone ?? "Europe/Tirane", generatedAt: report.generatedAt ?? null };
}
