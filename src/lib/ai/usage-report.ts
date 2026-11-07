import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";

export type AiUsageMonth = { calls: number; inputTokens: number; outputTokens: number };
/** Tokens billed by OpenAI for the month: prompt plus completion. */
export function totalTokens(usage: Pick<AiUsageMonth, "inputTokens" | "outputTokens">) {
  return usage.inputTokens + usage.outputTokens;
}
export type AiUsageSummary = { calls: number; tokens: number };
export function aiUsageSummary(usage: AiUsageMonth): AiUsageSummary {
  return { calls: usage.calls, tokens: totalTokens(usage) };
}

/** This month's OpenAI requests for a business. Only its owners and platform administrators may read it. */
export const loadAiUsage = cache(async function loadAiUsage(
  userId: string,
  businessId: string,
  platformAdmin: boolean,
): Promise<AiUsageMonth | null> {
  const db = createServiceSupabase();
  if (!platformAdmin) {
    const { data: member, error } = await db
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || member?.role !== "owner") return null;
  }
  const { data, error } = await db.rpc("ai_usage_month", { p_business: businessId });
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (error || !row) {
    if (error) console.error("[ai.usage] month", error.message);
    return null;
  }
  return {
    calls: Number(row.calls) || 0,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
  };
});
