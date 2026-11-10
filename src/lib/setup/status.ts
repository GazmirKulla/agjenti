import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { SetupStatus } from "./model";
export async function loadSetupStatus(
  businessId: string,
): Promise<SetupStatus> {
  const { data, error } = await createServiceSupabase().rpc(
    "business_setup_status",
    { p_business_id: businessId },
  );
  if (error) {
    if (["PGRST202", "42883"].includes(error.code))
      return {
        available: false,
        connected: false,
        productCount: 0,
        usableProducts: 0,
        unconfiguredProducts: 0,
        agentReady: false,
        signature: "",
        tested: false,
        launched: false,
      };
    throw new Error("Nuk u ngarkua progresi i konfigurimit.");
  }
  if (!data) throw new Error("Nuk u ngarkua progresi i konfigurimit.");
  // Any scan that was not a failure counts: it runs on its own afterwards.
  const { data: read } = await createServiceSupabase().from("business_discovery_jobs").select("id")
    .eq("business_id", businessId).neq("status", "failed").limit(1).maybeSingle();
  return { ...data, available: true, sourcesRead: Boolean(read) } as SetupStatus;
}
export const getSetupStatus = cache(loadSetupStatus);
