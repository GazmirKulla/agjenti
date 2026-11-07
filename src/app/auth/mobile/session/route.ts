import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { NATIVE_EMBED_COOKIE } from "@/lib/native/embedded";
import { dashboardLanguage, LANGUAGE_COOKIE } from "@/lib/dashboard/language/core";

export const runtime = "nodejs";
const failure = (status: number) => NextResponse.json({ error: "Hyrja në aplikacion nuk përfundoi. Provo përsëri." }, { status, headers: { "Cache-Control": "no-store" } });
/** Seconds until `exp`, or 0 when the value is not a JWT. Test tokens have no expiry claim. */
function accessTokenTtl(token: string) {
  try {
    const part = token.split(".")[1];
    if (!part) return Number.POSITIVE_INFINITY;
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp - Date.now() / 1000 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Exchange the native OAuth session for this origin's normal SSR cookies.
 * JSON-only + no CORS prevents cross-site form login. No credentials in URLs.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!request.headers.get("content-type")?.startsWith("application/json") ||
      (origin && origin !== "null" && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site") return failure(403);
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20000) { await reader.cancel(); return failure(413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body.access_token !== "string" || typeof body.refresh_token !== "string" ||
        !body.access_token || !body.refresh_token || body.access_token.length > 8192 || body.refresh_token.length > 8192) return failure(400);
    const next = typeof body.next === "string" && /^\/(?:b\/[^\\?#]+|onboarding|account)(?:[?][^\\#]*)?$/.test(body.next)
      ? body.next : "/auth/mobile/continue";
    const response = NextResponse.redirect(new URL(next, request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    // A previous account's session (plain or chunked) would otherwise shadow the new one.
    for (const name of (request.headers.get("cookie") ?? "").split(";").map(part => part.split("=")[0].trim()))
      if (/^sb-[\w-]+-auth-token(?:\.\d+)?$/.test(name)) response.cookies.set(name, "", { path: "/", maxAge: 0 });
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => [], setAll: values => { for (const { name, value, options } of values) response.cookies.set(name, value, { ...options, secure: new URL(request.url).protocol === "https:", sameSite: "lax" }); } },
    });
    // An expired access token would make setSession rotate the refresh token and
    // sign the phone out. The app must send a still-valid access token.
    if (accessTokenTtl(body.access_token) <= 20) return failure(401);
    const verified = await supabase.auth.getUser(body.access_token);
    if (verified.error || !verified.data.user) return failure(401);
    const session = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    if (session.error || session.data.user?.id !== verified.data.user.id) return failure(401);
    response.cookies.set(NATIVE_EMBED_COOKIE, "1", { httpOnly: true, path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:" });
    if (body.language !== undefined)
      response.cookies.set(LANGUAGE_COOKIE, dashboardLanguage(body.language), { path: "/", maxAge: 31536000, sameSite: "lax", secure: new URL(request.url).protocol === "https:" });
    return response;
  } catch { return failure(400); }
}
