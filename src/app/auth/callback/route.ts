import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/app";
	return raw;
}

function redirectBase(request: Request, origin: string): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const isLocal = process.env.NODE_ENV === "development";
	if (!isLocal && forwardedHost) return `https://${forwardedHost}`;
	return origin;
}

export async function GET(request: Request) {
	const { searchParams, origin } = new URL(request.url);
	const code = searchParams.get("code");
	const tokenHash = searchParams.get("token_hash");
	const type = searchParams.get("type") as EmailOtpType | null;
	const next = safeNext(searchParams.get("next"));
	const base = redirectBase(request, origin);
	const loginError = `${base}/login?error=oauth_callback`;

	const cookieStore = await cookies();
	const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] =
		[];

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
						pendingCookies.push(cookie);
						try {
							cookieStore.set(cookie.name, cookie.value, cookie.options);
						} catch {
							// Route handler may already be committing; cookies go on the response below.
						}
					}
				},
			},
		},
	);

	let error: Error | null = null;

	if (code) {
		const result = await supabase.auth.exchangeCodeForSession(code);
		error = result.error;
	} else if (tokenHash && type) {
		const result = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
		error = result.error;
	} else {
		return NextResponse.redirect(loginError);
	}

	if (error) {
		return NextResponse.redirect(loginError);
	}

	const response = NextResponse.redirect(`${base}${next}`);
	for (const { name, value, options } of pendingCookies) {
		response.cookies.set(name, value, options);
	}
	return response;
}
