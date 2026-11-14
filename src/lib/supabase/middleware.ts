import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/** Vercel stops middleware that has not responded within 25s. Auth-js retries a
 * failed refresh for up to 30s on its own, so the whole session check gets one
 * deadline well below that; an Auth outage then gets a clear answer instead of a hang. */
export const AUTH_CHECK_TIMEOUT_MS = 8000;

/** Every Auth request of this check shares the deadline's abort signal. */
function deadlineFetch(deadline: AbortSignal): typeof fetch {
  return (input, init) => {
    const outer = init?.signal;
    if (!outer) return fetch(input, { ...init, signal: deadline });
    const controller = new AbortController();
    const abort = (signal: AbortSignal) => controller.abort(signal.reason);
    for (const signal of [outer, deadline]) {
      if (signal.aborted) abort(signal);
      else signal.addEventListener("abort", () => abort(signal), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal });
  };
}

/** The session could not be verified (Auth unreachable or too slow). Cookies are left
 * untouched so nobody is signed out by an outage; the request is not let through. */
function authUnavailable(path: string) {
  const message = "Shërbimi i hyrjes nuk po përgjigjet. Provo përsëri pas pak.";
  if (path.startsWith("/api/"))
    return NextResponse.json({ error: message }, { status: 503, headers: { "Retry-After": "10" } });
  return new NextResponse(
    `<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agjenti.app</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center"><main><h1 style="font-size:1.25rem">${message}</h1><p><a href="">Rifresko faqen</a></p></main></body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "Retry-After": "10" } },
  );
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Public content and independently authenticated callbacks need no session lookup.
  // Keep login and protected pages on the session-refresh path.
  if (
    path === "/" ||
    path === "/api/webhooks/meta" ||
    path.startsWith("/api/catalogs/share/") ||
    path === "/api/cron/refresh-instagram-tokens" ||
    path === "/api/cron/business-discovery" ||
    path === "/api/instagram/oauth/callback" ||
    path === "/api/meta/data-deletion" ||
    path === "/api/meta/deauthorize" ||
    path === "/privacy" ||
    path === "/support" ||
    path === "/terms" ||
    path === "/data-deletion"
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const deadline = new AbortController();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: deadlineFetch(deadline.signal) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">(resolve => {
    timer = setTimeout(() => { deadline.abort(new Error("auth_check_timeout")); resolve("expired"); }, AUTH_CHECK_TIMEOUT_MS);
  });
  const result = await Promise.race([supabase.auth.getUser(), expired]).finally(() => clearTimeout(timer));
  const unreachable = result === "expired" || isAuthRetryableFetchError(result.error);
  const user = result === "expired" ? null : result.data.user;

  const isPublic = path === "/join" ||
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/instagram/oauth/callback") ||
    path.startsWith("/api/cron");

  // Public pages (login, auth callbacks, webhooks, cron) keep working without a session.
  if (!user && !isPublic && unreachable) return authUnavailable(path);

  if (!user && !isPublic && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    const redirected = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll())
      redirected.cookies.set(cookie);
    return redirected;
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/continue";
    url.search = "";
    const redirected = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll())
      redirected.cookies.set(cookie);
    return redirected;
  }

  return response;
}
