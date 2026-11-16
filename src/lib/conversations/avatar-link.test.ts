import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { avatarLinkExpiry, signedAvatarQuery, verifyAvatarLink } from "./avatar-link";

const NOW = Date.parse("2026-11-16T22:00:00Z");
beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-key"));
afterEach(() => vi.unstubAllEnvs());

it("keeps one link for the whole week and lets it live at most two weeks", () => {
  const expiry = avatarLinkExpiry(NOW);
  expect(expiry - NOW).toBeGreaterThan(7 * 86_400_000);
  expect(expiry - NOW).toBeLessThanOrEqual(14 * 86_400_000);
  expect(signedAvatarQuery("b", "c", "1", NOW)).toBe(signedAvatarQuery("b", "c", "1", NOW + 86_400_000));
});

it("accepts only the exact business, conversation and version it was signed for, before expiry", () => {
  const query = new URLSearchParams(signedAvatarQuery("b", "c", "1", NOW));
  expect(verifyAvatarLink("b", "c", query, NOW)).toBe(true);
  expect(verifyAvatarLink("b", "other", query, NOW)).toBe(false);
  expect(verifyAvatarLink("other", "c", query, NOW)).toBe(false);
  expect(verifyAvatarLink("b", "c", query, Number(query.get("e")))).toBe(false);
  const forged = new URLSearchParams(query); forged.set("e", String(Number(query.get("e")) + 1));
  expect(verifyAvatarLink("b", "c", forged, NOW)).toBe(false);
});

it("depends on the server secret", () => {
  const query = new URLSearchParams(signedAvatarQuery("b", "c", "1", NOW));
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "another-key");
  expect(verifyAvatarLink("b", "c", query, NOW)).toBe(false);
});
