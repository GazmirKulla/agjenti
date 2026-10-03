import { createServiceSupabase } from "@/lib/supabase/service";
import { loadSetupStatus } from "./status";
// Stores only a configuration fingerprint, never test content or CRM records.
export async function recordSetupTest(businessId: string, signature: string) {
  const current = await loadSetupStatus(businessId);
  if (!current.available || current.signature !== signature) return false;
  const { error } = await createServiceSupabase()
    .from("business_setup")
    .upsert({
      business_id: businessId,
      tested_signature: signature,
      tested_at: new Date().toISOString(),
    });
  return !error;
}
