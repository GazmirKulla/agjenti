import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
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

	const path = request.nextUrl.pathname;
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
		return NextResponse.redirect(url);
	}

	if (user && (path === "/login" || path === "/")) {
		const url = request.nextUrl.clone();
		url.pathname = "/app";
		url.search = "";
		return NextResponse.redirect(url);
	}

	return response;
}
