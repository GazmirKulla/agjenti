import { createHmac, timingSafeEqual } from "node:crypto";

type OAuthState = {
	businessId: string;
	userId: string;
	exp: number;
};

function secret(): string {
	return (
		process.env.INSTAGRAM_APP_SECRET?.trim() ||
		process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
		""
	);
}

export function signOAuthState(payload: Omit<OAuthState, "exp">, ttlMs = 10 * 60 * 1000): string {
	const body: OAuthState = { ...payload, exp: Date.now() + ttlMs };
	const json = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
	const sig = createHmac("sha256", secret()).update(json).digest("base64url");
	return `${json}.${sig}`;
}

export function verifyOAuthState(raw: string | null): OAuthState | null {
	if (!raw || !secret()) return null;
	const [json, sig] = raw.split(".");
	if (!json || !sig) return null;
	const expected = createHmac("sha256", secret()).update(json).digest("base64url");
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	try {
		const parsed = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as OAuthState;
		if (!parsed.businessId || !parsed.userId || parsed.exp < Date.now()) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function instagramAuthorizeUrl(state: string): string {
	const clientId = process.env.INSTAGRAM_APP_ID?.trim();
	const redirect = process.env.INSTAGRAM_OAUTH_REDIRECT_URI?.trim();
	if (!clientId || !redirect) {
		throw new Error("Mungon INSTAGRAM_APP_ID ose INSTAGRAM_OAUTH_REDIRECT_URI.");
	}
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirect,
		response_type: "code",
		force_authentication: "1",
		enable_fb_login: "0",
		scope: "instagram_business_basic,instagram_business_manage_messages",
		state,
	});
	return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export function graphVersion(): string {
	return process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || "v22.0";
}

export async function exchangeInstagramCode(code: string): Promise<{
	accessToken: string;
	userId: string;
	expiresAt: Date | null;
	username: string | null;
}> {
	const clientId = process.env.INSTAGRAM_APP_ID?.trim();
	const clientSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
	const redirect = process.env.INSTAGRAM_OAUTH_REDIRECT_URI?.trim();
	if (!clientId || !clientSecret || !redirect) {
		throw new Error("Mungojnë INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET ose INSTAGRAM_OAUTH_REDIRECT_URI.");
	}

	const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: "authorization_code",
			redirect_uri: redirect,
			code,
		}),
		signal: AbortSignal.timeout(20_000),
	});
	const shortJson = (await shortRes.json()) as {
		access_token?: string;
		user_id?: string | number;
		error_message?: string;
	};
	if (!shortRes.ok || !shortJson.access_token) {
		throw new Error(shortJson.error_message || "Këmbimi i kodit Instagram dështoi.");
	}

	const longUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(shortJson.access_token)}`;
	const longRes = await fetch(longUrl, { signal: AbortSignal.timeout(20_000) });
	const longJson = (await longRes.json()) as {
		access_token?: string;
		expires_in?: number;
		error?: { message?: string };
	};
	const token = longJson.access_token || shortJson.access_token;
	const expiresAt =
		typeof longJson.expires_in === "number"
			? new Date(Date.now() + longJson.expires_in * 1000)
			: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

	// `user_id` = Instagram professional account ID (IG_ID) used in webhooks/messaging.
	// `id` alone is an app-scoped ID and will NOT match webhook entry/recipient ids.
	const meRes = await fetch(
		`https://graph.instagram.com/${graphVersion()}/me?fields=id,user_id,username,name&access_token=${encodeURIComponent(token)}`,
		{ signal: AbortSignal.timeout(20_000) },
	);
	const me = (await meRes.json()) as {
		id?: string;
		user_id?: string | number;
		username?: string;
		name?: string;
	};
	const igProfessionalId = String(me.user_id || shortJson.user_id || "").trim();
	if (!igProfessionalId) {
		throw new Error("Mungon Instagram professional account ID (user_id).");
	}
	return {
		accessToken: token,
		userId: igProfessionalId,
		expiresAt,
		username: me.username ?? null,
	};
}

export async function refreshLongLivedToken(token: string): Promise<{
	accessToken: string;
	expiresAt: Date;
} | null> {
	const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
	const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	const data = (await response.json()) as {
		access_token?: string;
		expires_in?: number;
	};
	if (!response.ok || !data.access_token) return null;
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 60 * 24 * 60 * 60;
	return {
		accessToken: data.access_token,
		expiresAt: new Date(Date.now() + expiresIn * 1000),
	};
}

const DEFAULT_WEBHOOK_FIELDS =
	"messages,messaging_postbacks,messaging_referral,message_reactions,message_edit";

/**
 * App-level webhook config is not enough for real DMs.
 * Meta also requires enabling subscriptions on the Instagram account via this call.
 * @see https://developers.facebook.com/docs/instagram-platform/webhooks/
 */
export async function subscribeInstagramAccountWebhooks(
	accessToken: string,
	subscribedFields: string = DEFAULT_WEBHOOK_FIELDS,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const url = new URL(
		`https://graph.instagram.com/${graphVersion()}/me/subscribed_apps`,
	);
	url.searchParams.set("subscribed_fields", subscribedFields);
	url.searchParams.set("access_token", accessToken);

	const response = await fetch(url.toString(), {
		method: "POST",
		signal: AbortSignal.timeout(20_000),
	});
	const data = (await response.json()) as {
		success?: boolean;
		error?: { message?: string; type?: string; code?: number };
	};
	if (!response.ok || data.success !== true) {
		const error =
			data.error?.message || `subscribed_apps failed (${response.status})`;
		console.error("[instagram oauth] subscribed_apps failed", data);
		return { ok: false, error };
	}
	console.log("[instagram oauth] subscribed_apps ok", { subscribedFields });
	return { ok: true };
}
