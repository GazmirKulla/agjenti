import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Public content and independently authenticated callbacks need no session lookup.
  // Keep login and protected pages on the session-refresh path.
  if (
    path === "/" ||
    path === "/api/webhooks/meta" ||
    path === "/api/cron/refresh-instagram-tokens" ||
    path === "/api/instagram/oauth/callback" ||
    path === "/api/meta/data-deletion" ||
    path === "/api/meta/deauthorize" ||
    path === "/privacy" ||
    path === "/terms" ||
    path === "/data-deletion"
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/instagram/oauth/callback") ||
    path.startsWith("/api/cron");

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
