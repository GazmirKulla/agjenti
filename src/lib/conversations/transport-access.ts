import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { bearerClient, bearerToken } from "@/lib/auth/request";
export const isTransportId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
/** Browser cookie identity, or the native app's bearer token. An Authorization header never falls back to cookies. */
async function requestUserId(request?: Request) {
  if (request?.headers.has("authorization")) {
    const token = bearerToken(request);
    if (!token) return null;
    const { data, error } = await bearerClient(token).auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  }
  const auth = await createServerSupabase();
  const { data: { user }, error } = await auth.auth.getUser();
  return error || !user ? null : user.id;
}
/** Current membership, not client readiness, JWT metadata or a cached UI role. */
export async function transportAccess(businessId: string, request?: Request) {
  if (!isTransportId(businessId)) return null;
  const userId = await requestUserId(request);
  if (!userId) return null;
  const db = createServiceSupabase();
  const [member, admin] = await Promise.all([
    db.from("business_users").select("user_id").eq("business_id", businessId).eq("user_id", userId).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  return (!member.error && member.data || !admin.error && admin.data) ? { userId, db } : null;
}
