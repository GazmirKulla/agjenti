import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const failure = (status: number) => NextResponse.json({ error: "Hyrja në aplikacion nuk përfundoi. Provo përsëri." }, { status, headers: { "Cache-Control": "no-store" } });

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
    const response = NextResponse.redirect(new URL("/auth/mobile/continue", request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => [], setAll: values => { for (const { name, value, options } of values) response.cookies.set(name, value, { ...options, secure: new URL(request.url).protocol === "https:", sameSite: "lax" }); } },
    });
    const verified = await supabase.auth.getUser(body.access_token);
    if (verified.error || !verified.data.user) return failure(401);
    const session = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    if (session.error || session.data.user?.id !== verified.data.user.id) return failure(401);
    return response;
  } catch { return failure(400); }
}
