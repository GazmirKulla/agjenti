import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { refreshLongLivedToken } from "@/lib/instagram/oauth";
import { createServiceSupabase } from "@/lib/supabase/service";

function isAuthorizedCron(request: Request): boolean {
	const secret = process.env.CRON_SECRET?.trim();
	if (!secret) return false;
	const header = request.headers.get("authorization");
	return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
	if (!isAuthorizedCron(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const supabase = createServiceSupabase();
	const { data: rows } = await supabase
		.from("instagram_connections")
		.select("id,access_token_ciphertext,expires_at,refreshed_at,status")
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
				continue;
			}
			await supabase
				.from("instagram_connections")
				.update({
					access_token_ciphertext: encryptSecret(next.accessToken),
					expires_at: next.expiresAt.toISOString(),
					refreshed_at: new Date().toISOString(),
					status: "connected",
					last_error: null,
				})
				.eq("id", row.id);
			refreshed += 1;
		} catch (err) {
			console.error("[cron refresh]", err);
		}
	}
	return NextResponse.json({ ok: true, refreshed });
}
