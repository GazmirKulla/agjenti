import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";

function keyBytes(): Buffer {
	const secret = process.env.TOKEN_ENCRYPTION_KEY?.trim();
	if (!secret) {
		throw new Error("Mungon TOKEN_ENCRYPTION_KEY.");
	}
	if (/^[0-9a-fA-F]{64}$/.test(secret)) {
		return Buffer.from(secret, "hex");
	}
	return scryptSync(secret, "agjenti.token", 32);
}

export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
	const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
	const [version, ivB64, tagB64, dataB64] = payload.split(".");
	if (version !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
		throw new Error("Token i enkriptuar i pavlefshëm.");
	}
	const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64url"));
	decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, "base64url")),
		decipher.final(),
	]).toString("utf8");
}
