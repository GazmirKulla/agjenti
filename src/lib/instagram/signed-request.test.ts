import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parseMetaSignedRequest } from "@/lib/instagram/signed-request";

function makeSignedRequest(payload: Record<string, unknown>, secret: string) {
	const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8")
		.toString("base64url")
		.replace(/=+$/g, "");
	const signature = createHmac("sha256", secret)
		.update(encodedPayload)
		.digest("base64url")
		.replace(/=+$/g, "");
	return `${signature}.${encodedPayload}`;
}

describe("parseMetaSignedRequest", () => {
	afterEach(() => {
		delete process.env.INSTAGRAM_APP_SECRET;
		delete process.env.META_APP_SECRET;
	});

	it("verifies a valid Instagram app signed request", () => {
		process.env.INSTAGRAM_APP_SECRET = "ig-secret";
		const signed = makeSignedRequest(
			{
				algorithm: "HMAC-SHA256",
				issued_at: 1_700_000_000,
				user_id: "28327737183554668",
			},
			"ig-secret",
		);
		expect(parseMetaSignedRequest(signed)).toEqual({
			algorithm: "HMAC-SHA256",
			issued_at: 1_700_000_000,
			user_id: "28327737183554668",
		});
	});

	it("rejects a tampered signature", () => {
		process.env.INSTAGRAM_APP_SECRET = "ig-secret";
		const signed = makeSignedRequest(
			{ algorithm: "HMAC-SHA256", user_id: "1" },
			"ig-secret",
		);
		expect(parseMetaSignedRequest(`x${signed}`)).toBeNull();
	});
});
