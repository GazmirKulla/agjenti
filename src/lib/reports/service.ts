import { createServiceSupabase } from "@/lib/supabase/service";
import type { ReportDay } from "./model";

/** Daily numbers for the last `range` days and the `range` days before them. */
export async function loadBusinessReport(businessId: string, range: number) {
  const { data, error } = await createServiceSupabase().rpc("business_report", { p_business: businessId, p_days: range });
  if (error || !data) throw new Error("Raporti nuk u ngarkua. Provo përsëri.");
  const report = data as { days: ReportDay[]; aiMessagesThisPeriod: number };
  return { days: report.days ?? [], aiMessagesThisPeriod: Number(report.aiMessagesThisPeriod ?? 0) };
}
