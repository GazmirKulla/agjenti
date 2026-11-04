import { bearerClient } from "@/lib/auth/request";
import type { CommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser } from "@/lib/tenant/access";

/** Fresh membership reads: never accept actor/tenant identities from a form or LLM. */
export async function operationActor(businessId: string, expectedUserId?: string, accessToken?: string): Promise<CommandActor> {
  const user = accessToken ? (await bearerClient(accessToken).auth.getUser(accessToken)).data.user : await getSessionUser();
  if (!user || expectedUserId && user.id !== expectedUserId) throw Error("Sesioni ndryshoi. Hyr përsëri.");
  const db = createServiceSupabase();
  const [member, admin, business] = await Promise.all([
    db.from("business_users").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("businesses").select("id,slug,name,catalog_source,auto_reply").eq("id", businessId).maybeSingle(),
  ]);
  if (member.error || admin.error || business.error || !business.data || !member.data && !admin.data) throw Error("Nuk ke qasje në këtë biznes.");
  return { userId: user.id, business: business.data };
}
