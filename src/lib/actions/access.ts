import { createServiceSupabase } from "@/lib/supabase/service";
import type { ActionKey } from "./catalog";
export async function requireActionAccess(
  businessId: string,
  userId: string | null,
  key: ActionKey,
  automated = false,
) {
  const { data, error } = await createServiceSupabase().rpc(
    "can_execute_business_action",
    {
      p_business: businessId,
      p_user: userId,
      p_action: key,
      p_automated: automated,
    },
  );
  if (error)
    throw new Error(
      "Nuk u verifikuan lejet e veprimit. Kontrollo migrimin e katalogut.",
    );
  if (data !== true)
    throw new Error(
      "Ky veprim nuk lejohet nga paketa, konfigurimi ose roli yt.",
    );
}
