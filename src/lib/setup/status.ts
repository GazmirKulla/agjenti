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
  return { ...data, available: true } as SetupStatus;
}
export const getSetupStatus = cache(loadSetupStatus);
