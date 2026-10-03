import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { appOrigin } from "@/lib/auth/app-origin";

type CookieToSet = {
	name: string;
	value: string;
	options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

/**
 * Server-side Google OAuth start so the PKCE code_verifier is written via Set-Cookie
 * on the redirect response (browser client often drops it before navigating to Google).
 */
export async function GET(request: Request) {
	const origin = appOrigin(request);
	const pending: CookieToSet[] = [];
	const cookieStore = await cookies();

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return cookieStore.getAll();
				},
				setAll(cookiesToSet) {
					for (const cookie of cookiesToSet) {
						pending.push(cookie);
						try {
							cookieStore.set(cookie.name, cookie.value, cookie.options);
						} catch {
							// Response cookies are applied below.
						}
					}
				},
			},
		},
	);

	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: "google",
		options: {
			redirectTo: `${origin}/auth/callback?next=/auth/continue`,
			queryParams: { prompt: "select_account" },
			skipBrowserRedirect: true,
		},
	});

	if (error || !data.url) {
		console.error("[auth/google] signInWithOAuth failed", error?.message);
		return NextResponse.redirect(`${origin}/login?error=oauth_callback`);
	}

	const response = NextResponse.redirect(data.url);
	for (const { name, value, options } of pending) {
		response.cookies.set(name, value, options);
	}
	return response;
}
