import { after, NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto/tokens";
import {
	exchangeInstagramCode,
	subscribeInstagramAccountWebhooks,
	verifyOAuthState,
} from "@/lib/instagram/oauth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { enqueueDiscovery, runDiscoveryQueue } from "@/lib/discovery/queue";
import { getAppSettings } from "@/lib/platform/settings";
export const maxDuration = 180;

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

		const subscription = await subscribeInstagramAccountWebhooks(exchanged.accessToken);
		if (!subscription.ok) {
			console.error("[instagram oauth] webhook subscription failed", subscription.error);
		}

		const supabase = createServiceSupabase();
		await supabase
			.from("instagram_connections")
			.update({ status: "disconnected" })
			.eq("business_id", state.businessId)
			.neq("status", "disconnected");
		const saved = await supabase.from("instagram_connections").upsert(
			{
				business_id: state.businessId,
				ig_user_id: exchanged.userId,
				username: exchanged.username,
				access_token_ciphertext: encryptSecret(exchanged.accessToken),
				expires_at: exchanged.expiresAt?.toISOString() ?? null,
				refreshed_at: new Date().toISOString(),
				status: "connected",
				last_error: subscription.ok ? null : `subscribed_apps: ${subscription.error}`,
				updated_at: new Date().toISOString(),
				discovery_generation: crypto.randomUUID(),
			},
			{ onConflict: "ig_user_id" },
		);
		if (saved.error) throw new Error("Instagram connection was not saved");
		const { data: business } = await supabase
			.from("businesses")
			.select("slug")
			.eq("id", state.businessId)
			.maybeSingle();
		const connectedQuery = subscription.ok ? "connected=1" : "connected=1&webhook_sub=error";
		let discovery = false;
		try {
			if ((await getAppSettings()).onboarding_enabled) {
				await enqueueDiscovery(state.businessId, state.userId, "instagram");
				discovery = true;
				after(async () => { await runDiscoveryQueue(state.businessId).catch(() => console.error("[discovery] worker unavailable")); });
			}
		} catch { console.error("[discovery] analysis could not be queued"); }
		return NextResponse.redirect(
			new URL(`/b/${business?.slug ?? "zana"}/${discovery ? "setup" : "instagram"}?${connectedQuery}`, url.origin),
		);
	} catch (error) {
		console.error("[instagram oauth]", error);
		return NextResponse.redirect(new URL(`/auth/continue?ig=error`, url.origin));
	}
}
