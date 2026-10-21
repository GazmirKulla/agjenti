import { createClient } from "@supabase/supabase-js";
import { getSessionUser } from "@/lib/tenant/access";

export function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  return value && /^Bearer [A-Za-z0-9._-]{1,8192}$/.test(value) ? value.slice(7) : undefined;
}
/** Native bearer requests never fall back to cookie identity. Browser writes retain CSRF checks. */
export function permittedWrite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (request.headers.has("authorization")) return Boolean(bearerToken(request)) && (!origin || origin === new URL(request.url).origin);
  return origin === new URL(request.url).origin;
}
export function bearerClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
export async function getRequestUser(request: Request) {
  if (!request.headers.has("authorization")) return getSessionUser();
  const token = bearerToken(request);
  if (!token) return null;
  const { data, error } = await bearerClient(token).auth.getUser(token);
  return error ? null : data.user;
}
