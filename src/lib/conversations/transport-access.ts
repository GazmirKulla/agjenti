import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
export const isTransportId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
/** Current membership, not client readiness, JWT metadata or a cached UI role. */
export async function transportAccess(businessId: string) {
  if (!isTransportId(businessId)) return null;
  const auth = await createServerSupabase();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) return null;
  const db = createServiceSupabase();
  const [member, admin] = await Promise.all([
    db.from("business_users").select("user_id").eq("business_id", businessId).eq("user_id", user.id).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  return (!member.error && member.data || !admin.error && admin.data) ? { userId: user.id, db } : null;
}
