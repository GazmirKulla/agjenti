import { expect, it } from "vitest";
import { channelHealth, effectiveStatus, needsAttention, timeAgo } from "./health";

const now = Date.parse("2026-11-10T12:00:00Z");
const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();

it("treats a connected Instagram past its expiry as expired", () => {
  expect(effectiveStatus({ status: "connected", expiresAt: inDays(-1) }, now)).toBe("expired");
  expect(effectiveStatus(null, now)).toBe("disconnected");
});

it("warns before the Instagram authorization expires and on recent errors", () => {
  expect(channelHealth("instagram", { status: "connected", expiresAt: inDays(3) }, null, now)).toMatchObject({ level: "warning" });
  expect(channelHealth("instagram", { status: "connected", expiresAt: inDays(30) }, null, now)).toEqual({ level: "ok", notes: [], info: [] });
  expect(channelHealth("whatsapp", { status: "connected", lastError: "token" }, null, now).level).toBe("warning");
  expect(channelHealth("instagram", { status: "connected", expiresAt: inDays(-1) }, null, now).level).toBe("error");
});

it("notes a quiet week without calling it a problem", () => {
  const health = channelHealth("whatsapp", { status: "connected" }, { lastInboundAt: null, weekInbound: 0 }, now);
  expect(health.level).toBe("ok");
  expect(health.notes).toHaveLength(0);
  expect(health.info).toHaveLength(1);
});

it("marks the menu only for channels that need the owner", () => {
  expect(needsAttention("instagram", null, now)).toBe(false);
  expect(needsAttention("instagram", { status: "connected", expiresAt: inDays(2) }, now)).toBe(true);
  expect(needsAttention("whatsapp", { status: "connected" }, now)).toBe(false);
});

it("words how long ago a message came", () => {
  expect(timeAgo(new Date(now - 30 * 60_000).toISOString(), now)).toBe("30 min më parë");
  expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 orë më parë");
  expect(timeAgo(null, now)).toBeNull();
});
