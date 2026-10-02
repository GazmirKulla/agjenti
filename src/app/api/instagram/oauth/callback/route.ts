import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto/tokens";
import { exchangeInstagramCode, verifyOAuthState } from "@/lib/instagram/oauth";
import { createServiceSupabase } from "@/lib/supabase/service";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const err = url.searchParams.get("error");
	if (err) {
		return NextResponse.redirect(new URL(`/auth/continue?ig=denied`, url.origin));
	}
	const state = verifyOAuthState(url.searchParams.get("state"));
	const code = url.searchParams.get("code");
	if (!state || !code) {
		return NextResponse.redirect(new URL(`/login?error=oauth`, url.origin));
	}
	try {
		const exchanged = await exchangeInstagramCode(code);
		if (!exchanged.userId) {
			throw new Error("Mungon ig user id.");
		}
		const supabase = createServiceSupabase();
		await supabase
			.from("instagram_connections")
			.update({ status: "disconnected" })
			.eq("business_id", state.businessId)
			.neq("status", "disconnected");
		await supabase.from("instagram_connections").upsert(
			{
				business_id: state.businessId,
				ig_user_id: exchanged.userId,
				username: exchanged.username,
				access_token_ciphertext: encryptSecret(exchanged.accessToken),
				expires_at: exchanged.expiresAt?.toISOString() ?? null,
				refreshed_at: new Date().toISOString(),
				status: "connected",
				last_error: null,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "ig_user_id" },
		);
		const { data: business } = await supabase
			.from("businesses")
			.select("slug")
			.eq("id", state.businessId)
			.maybeSingle();
		return NextResponse.redirect(
			new URL(`/b/${business?.slug ?? "zana"}/instagram?connected=1`, url.origin),
		);
	} catch (error) {
		console.error("[instagram oauth]", error);
		return NextResponse.redirect(new URL(`/auth/continue?ig=error`, url.origin));
	}
}
