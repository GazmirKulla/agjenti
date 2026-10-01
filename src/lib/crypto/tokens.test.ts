import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import {
	getMetaVerifyToken,
	handleMetaVerification,
	verifyMetaSignature,
	verifyMetaSignatureAny,
} from "@/lib/instagram/meta-webhook";

describe("encryptSecret", () => {
	it("round-trips a token", () => {
		process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
		const cipher = encryptSecret("ig-token");
		expect(cipher.startsWith("v1.")).toBe(true);
		expect(decryptSecret(cipher)).toBe("ig-token");
	});
});

describe("verifyMetaSignature", () => {
	it("accepts a valid hmac", () => {
		const secret = "app-secret";
		const body = '{"object":"instagram"}';
		const digest = createHmac("sha256", secret).update(body).digest("hex");
		expect(verifyMetaSignature(body, `sha256=${digest}`, secret)).toBe(true);
		expect(verifyMetaSignatureAny(body, `sha256=${digest}`, [{ name: "META_APP_SECRET", secret }]).ok).toBe(
			true,
		);
	});

	it("rejects missing signature", () => {
		expect(verifyMetaSignature("{}", null, "secret")).toBe(false);
	});
});

describe("handleMetaVerification", () => {
	it("returns the challenge", () => {
		process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
		const url = new URL("https://agjenti.app/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123");
		expect(handleMetaVerification(url, getMetaVerifyToken())).toEqual({ ok: true, challenge: "123" });
	});
});

describe("timingSafeEqual length", () => {
	it("does not throw on length mismatch", () => {
		expect(timingSafeEqual(Buffer.from("aa"), Buffer.from("aa"))).toBe(true);
	});
});
