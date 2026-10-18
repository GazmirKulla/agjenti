import { createServiceSupabase } from "@/lib/supabase/service";
import { AssistantError } from "./model";
import type { ActivationActor } from "./activation-contract";

/** Rechecked for both inspection and confirmation; never inferred from an AI plan. */
export async function canConfigureCapability(actor: ActivationActor) {
  const db = createServiceSupabase();
  const [member, admin] = await Promise.all([
    db.from("business_users").select("role").eq("business_id", actor.businessId).eq("user_id", actor.userId).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", actor.userId).maybeSingle(),
  ]);
  if (member.error || admin.error) throw new AssistantError("Nuk u verifikuan lejet. Provo përsëri.");
  return member.data?.role === "owner" || Boolean(admin.data);
}
