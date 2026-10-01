import { createHmac, timingSafeEqual } from "node:crypto";

export function getMetaAppSecret(): string | null {
	return process.env.META_APP_SECRET?.trim() || null;
}

export function getMetaVerifyToken(): string | null {
	return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null;
}

export function getInstagramAppSecret(): string | null {
	return process.env.INSTAGRAM_APP_SECRET?.trim() || null;
}

export type MetaSignatureSecretName = "META_APP_SECRET" | "INSTAGRAM_APP_SECRET" | "unknown";

export type MetaSignatureMatch = { ok: true; matched: MetaSignatureSecretName } | { ok: false };

export function listInstagramWebhookSecrets(): Array<{
	name: MetaSignatureSecretName;
	secret: string;
}> {
	const secrets: Array<{ name: MetaSignatureSecretName; secret: string }> = [];
	const meta = getMetaAppSecret();
	const instagram = getInstagramAppSecret();
	if (meta) secrets.push({ name: "META_APP_SECRET", secret: meta });
	if (instagram && instagram !== meta) {
		secrets.push({ name: "INSTAGRAM_APP_SECRET", secret: instagram });
	}
	return secrets;
}

export function verifyMetaSignatureAny(
	rawBody: string,
	signatureHeader: string | null,
	secrets: Array<{ name: MetaSignatureSecretName; secret: string }> = listInstagramWebhookSecrets(),
): MetaSignatureMatch {
	if (secrets.length === 0) return { ok: false };
	for (const entry of secrets) {
		if (verifyMetaSignature(rawBody, signatureHeader, entry.secret)) {
			return { ok: true, matched: entry.name };
		}
	}
	return { ok: false };
}

export function verifyMetaSignature(
	rawBody: string,
	signatureHeader: string | null,
	appSecret: string | null = getMetaAppSecret(),
): boolean {
	if (!appSecret) return false;
	if (!signatureHeader?.startsWith("sha256=")) return false;

	const provided = signatureHeader.slice("sha256=".length).trim();
	const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
	try {
		const a = Buffer.from(provided, "utf8");
		const b = Buffer.from(expected, "utf8");
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

export type MetaVerificationResult = { ok: true; challenge: string } | { ok: false };

export function handleMetaVerification(
	url: URL,
	verifyToken: string | null = getMetaVerifyToken(),
): MetaVerificationResult {
	const mode = url.searchParams.get("hub.mode");
	const token = url.searchParams.get("hub.verify_token");
	const challenge = url.searchParams.get("hub.challenge");

	if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
		return { ok: true, challenge };
	}
	return { ok: false };
}
