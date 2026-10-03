import { createHmac, timingSafeEqual } from "node:crypto";
import {
	getInstagramAppSecret,
	getMetaAppSecret,
} from "@/lib/instagram/meta-webhook";

export type MetaSignedRequestPayload = {
	user_id?: string;
	algorithm?: string;
	issued_at?: number;
	expires?: number;
	[key: string]: unknown;
};

function base64UrlToBuffer(value: string): Buffer {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	return Buffer.from(padded + pad, "base64");
}

function verifySignedRequestWithSecret(
	signedRequest: string,
	secret: string,
): MetaSignedRequestPayload | null {
	const parts = signedRequest.split(".");
	if (parts.length !== 2) return null;
	const [encodedSig, encodedPayload] = parts;
	if (!encodedSig || !encodedPayload) return null;

	const signature = base64UrlToBuffer(encodedSig);
	const expected = createHmac("sha256", secret)
		.update(encodedPayload)
		.digest();
	if (
		signature.length !== expected.length ||
		!timingSafeEqual(signature, expected)
	) {
		return null;
	}

	try {
		const json = base64UrlToBuffer(encodedPayload).toString("utf8");
		const data = JSON.parse(json) as MetaSignedRequestPayload;
		if (data.algorithm && data.algorithm !== "HMAC-SHA256") return null;
		return data;
	} catch {
		return null;
	}
}

/** Verify Meta/Instagram signed_request using available app secrets. */
export function parseMetaSignedRequest(
	signedRequest: string | null | undefined,
): MetaSignedRequestPayload | null {
	const raw = signedRequest?.trim();
	if (!raw) return null;
	const secrets = [getInstagramAppSecret(), getMetaAppSecret()].filter(
		(value, index, list): value is string =>
			Boolean(value) && list.indexOf(value) === index,
	);
	for (const secret of secrets) {
		const parsed = verifySignedRequestWithSecret(raw, secret);
		if (parsed) return parsed;
	}
	return null;
}

export async function readSignedRequestFromRequest(
	request: Request,
): Promise<string | null> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const json = (await request.json().catch(() => null)) as {
			signed_request?: string;
		} | null;
		return json?.signed_request?.trim() || null;
	}
	const form = await request.formData().catch(() => null);
	const value = form?.get("signed_request");
	return typeof value === "string" ? value.trim() : null;
}
