import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { refreshLongLivedToken } from "@/lib/instagram/oauth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { runBusinessLogoRefresh } from "@/lib/businesses/logo";
import { recordSystem, stepFailure, trackScheduledJob } from "@/lib/tracking/system-events";

function isAuthorizedCron(request: Request): boolean {
	const secret = process.env.CRON_SECRET?.trim();
	if (!secret) return false;
	const header = request.headers.get("authorization");
	return header === `Bearer ${secret}`;
}

export const maxDuration = 120;

async function runJob(request: Request) {
	if (!isAuthorizedCron(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const supabase = createServiceSupabase();
	const { data: rows } = await supabase
		.from("instagram_connections")
		.select("id,business_id,access_token_ciphertext,expires_at,refreshed_at,status")
		.eq("status", "connected");
	let refreshed = 0;
	for (const row of rows ?? []) {
		const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
		if (expires && expires - Date.now() > 7 * 24 * 60 * 60 * 1000) continue;
		const refreshedAt = row.refreshed_at ? new Date(row.refreshed_at).getTime() : 0;
		if (refreshedAt && Date.now() - refreshedAt < 24 * 60 * 60 * 1000) continue;
		try {
			const current = decryptSecret(row.access_token_ciphertext);
			const next = await refreshLongLivedToken(current);
			if (!next) {
				await supabase
					.from("instagram_connections")
					.update({ status: "expired", last_error: "refresh_failed" })
					.eq("id", row.id);
				await recordSystem("system.instagram_token", "refresh_failed", { businessId: row.business_id, reason: "token_rejected", ref: row.id });
				continue;
			}
			await supabase
				.from("instagram_connections")
				.update({
					access_token_ciphertext: encryptSecret(next.accessToken),
					expires_at: next.expiresAt.toISOString(),
					refreshed_at: new Date().toISOString(),
					status: "connected",
				})
				.eq("id", row.id);
			// Only the refresh's own error is cleared: a webhook subscription error stays visible.
			await supabase.from("instagram_connections").update({ last_error: null }).eq("id", row.id).eq("last_error", "refresh_failed");
			await recordSystem("system.instagram_token", "refreshed", { businessId: row.business_id, ref: row.id });
			refreshed += 1;
		} catch (err) {
			console.error("[cron refresh]", err);
			await recordSystem("system.instagram_token", "refresh_failed", { businessId: row.business_id, reason: stepFailure("system.instagram_token", "refresh", err, row.id), ref: row.id });
		}
	}
	// With fresh tokens: copy each connected account's profile photo as the business logo, weekly.
	let logos: Awaited<ReturnType<typeof runBusinessLogoRefresh>> | null = null;
	try { logos = await runBusinessLogoRefresh(supabase, { budgetMs: 45_000 }); }
	catch (err) { console.error("[cron business logos]", err instanceof Error ? err.message : err); }
	return NextResponse.json({ ok: true, refreshed, logos });
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("refresh-instagram-tokens", () => runJob(request));
