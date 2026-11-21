import { graphVersion } from "@/lib/instagram/oauth";
import type { createServiceSupabase } from "@/lib/supabase/service";
import { metaCode, recordSystem } from "@/lib/tracking/system-events";

/**
 * A token Meta no longer accepts (Graph error 190: password changed, session expired or invalidated,
 * app removed). The connection then cannot read or answer messages until the owner reconnects it.
 */
export type MetaError = { code?: unknown; error_subcode?: unknown };

/** Pure: true when Meta rejected the token itself (code 190), not a permission or a passing error. */
export function isRejectedToken(error: MetaError | null | undefined) {
	return Number(error?.code) === 190;
}

/** The connection's `last_error` for a rejected token: "token_rejected: meta_190_460". Never Meta's text. */
export function rejectedTokenError(error: MetaError | null | undefined) {
	return `token_rejected: ${metaCode(error ?? { code: 190 })}`;
}

export type TokenCheck = { valid: true } | { valid: false; error: MetaError } | { valid: null };

/**
 * A cheap read-only call with the token (the account's username). `valid: null` means the answer said
 * nothing about the token (network, timeout, Meta down, another error): the connection is left as it is.
 */
export async function checkInstagramToken(accountId: string, token: string): Promise<TokenCheck> {
	try {
		const response = await fetch(`https://graph.instagram.com/${graphVersion()}/${encodeURIComponent(accountId)}?fields=username`, {
			headers: { Authorization: `Bearer ${token}` },
			cache: "no-store",
			signal: AbortSignal.timeout(15_000),
		});
		if (response.ok) return { valid: true };
		const body = (await response.json().catch(() => null)) as { error?: MetaError } | null;
		return isRejectedToken(body?.error) ? { valid: false, error: body!.error! } : { valid: null };
	} catch {
		return { valid: null };
	}
}

type Db = Pick<ReturnType<typeof createServiceSupabase>, "from">;

/**
 * Marks a connected Instagram connection as expired because Meta rejected its token, and records it in
 * Shëndeti i Agjentit. The panel then shows "Rilidh Instagram" and the admin's "lidhjet që duken aktive
 * por nuk punojnë" lists it. Only a connected row changes: a disconnected or revoked one stays as it is.
 * `step` says where it was found: "check" (the daily job), "send", "campaign".
 */
export async function markInstagramTokenRejected(db: Db, connection: { id: string; businessId: string }, step: string, error?: MetaError | null) {
	const { error: updateError } = await db.from("instagram_connections")
		.update({ status: "expired", last_error: rejectedTokenError(error), updated_at: new Date().toISOString() })
		.eq("id", connection.id).eq("status", "connected");
	if (updateError) console.error("[instagram token] could not mark expired", connection.id);
	await recordSystem("system.instagram_token", "token_rejected", { businessId: connection.businessId, reason: `${step}:${metaCode(error ?? { code: 190 })}`, ref: connection.id });
}
