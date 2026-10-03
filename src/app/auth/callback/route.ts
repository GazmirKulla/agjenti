import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/auth/app-origin";

type CookieToSet = {
	name: string;
	value: string;
	options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

function safeNext(raw: string | null, type: EmailOtpType | null): string {
	if (raw === "/auth/reset-password" || type === "recovery") {
		return "/auth/reset-password";
	}
	if (raw?.startsWith("/") && !raw.startsWith("//")) {
		return raw;
	}
	return "/auth/continue";
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const tokenHash = searchParams.get("token_hash");
	const type = searchParams.get("type") as EmailOtpType | null;
	const next = safeNext(searchParams.get("next"), type);
	const origin = appOrigin(request);
	const loginError = `${origin}/login?error=oauth_callback`;

	const cookieStore = await cookies();
	const pending: CookieToSet[] = [];

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
							// Applied on the redirect response below.
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
		if (error) {
			console.error("[auth/callback] exchangeCodeForSession", error.message);
		}
	} else if (tokenHash && type) {
		const result = await supabase.auth.verifyOtp({
			type,
			token_hash: tokenHash,
		});
		error = result.error;
	} else {
		return NextResponse.redirect(loginError);
	}

	if (error) {
		return NextResponse.redirect(loginError);
	}

	const response = NextResponse.redirect(`${origin}${next}`);
	for (const { name, value, options } of pending) {
		response.cookies.set(name, value, options);
	}
	return response;
}
