import { createServiceSupabase } from "@/lib/supabase/service";
import { parseBusinessProcess } from "./business-process";
export async function loadBusinessProcess(businessId: string) {
  const result = await createServiceSupabase().from("business_discovery").select("operating_workflow,process_revision").eq("business_id", businessId).maybeSingle();
  // Existing replies remain available during an additive migration rollout.
  if (result.error && ["42703", "42P01", "PGRST204", "PGRST205"].includes(result.error.code)) return { process: null, revision: 0 };
  if (result.error) throw new Error("Nuk u ngarkua rrjedha e biznesit.");
  return { process: parseBusinessProcess(result.data?.operating_workflow, result.data?.operating_workflow?.source === "manual"), revision: result.data?.process_revision ?? 0 };
}
