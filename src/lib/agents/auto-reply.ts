import { createServiceSupabase } from "@/lib/supabase/service";
import { loadSetupStatus } from "@/lib/setup/status";
import { setupGateMessage } from "@/lib/setup/model";
/** Shared with manual settings. Launch retains its SQL readiness checks. */
export async function setBusinessAutoReply(businessId: string, enabled: boolean, expected: boolean) {
  const db = createServiceSupabase();
  if (enabled && !expected) {
    const blocked = setupGateMessage(await loadSetupStatus(businessId));
    if (blocked) throw Error(blocked);
    const launch = await db.rpc("launch_business", { p_business_id: businessId, p_automatic: true });
    if (launch.error) throw Error("Konfigurimi ndryshoi. Kontrollo hapat nga Dashboard.");
    return;
  }
  const result = await db.from("businesses").update({ auto_reply: enabled }).eq("id", businessId).eq("auto_reply", expected).select("id").maybeSingle();
  if (result.error || !result.data) throw Error("Konfigurimi ndryshoi ose nuk u ruajt.");
}
