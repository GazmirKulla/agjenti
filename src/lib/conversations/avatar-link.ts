import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Photo links are signed when the server renders a page the viewer is allowed to see, and checked
 * locally by the avatar route: no Auth or membership lookup per image. A link stays the same for a
 * whole week (so the browser cache holds across Inbox refreshes) and works for at most two weeks.
 */
const WEEK_MS = 7 * 86_400_000;
const MAX_LIFETIME_MS = 2 * WEEK_MS;

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("Mungon TOKEN_ENCRYPTION_KEY.");
  // A purpose-bound key, never the encryption key itself.
  return createHmac("sha256", secret).update("agjenti.participant-avatar-link.v1").digest();
}

function sign(businessId: string, conversationId: string, version: string, expires: number): string {
  return createHmac("sha256", key()).update(`${businessId}:${conversationId}:${version}:${expires}`).digest("base64url");
}

export function avatarLinkExpiry(now = Date.now()): number {
  return (Math.floor(now / WEEK_MS) + 2) * WEEK_MS;
}

export function signedAvatarQuery(businessId: string, conversationId: string, version: string, now = Date.now()): string {
  const expires = avatarLinkExpiry(now);
  return new URLSearchParams({ v: version, e: String(expires), s: sign(businessId, conversationId, version, expires) }).toString();
}

/** True only for an unexpired link signed for exactly this business and conversation. */
export function verifyAvatarLink(businessId: string, conversationId: string, params: URLSearchParams, now = Date.now()): boolean {
  const version = params.get("v") ?? "";
  const expires = Number(params.get("e"));
  const signature = params.get("s") ?? "";
  if (version.length > 32 || !Number.isSafeInteger(expires) || expires <= now || expires > now + MAX_LIFETIME_MS) return false;
  let expected: Buffer;
  try { expected = Buffer.from(sign(businessId, conversationId, version, expires)); } catch { return false; }
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
