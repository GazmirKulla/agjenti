import { createServerSupabase } from "@/lib/supabase/server";
import { bearerClient, bearerToken } from "./request";

/** Keep reads under the verified user's JWT/RLS, including native requests.
 * An explicit invalid Authorization header must never fall back to cookies. */
export async function authenticatedReadClient(request?: Request) {
  const native = request?.headers.has("authorization") ?? false;
  const token = request ? bearerToken(request) : undefined;
  if (native && !token) return null;
  const db = token ? bearerClient(token) : await createServerSupabase();
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { db, user: data.user };
}
