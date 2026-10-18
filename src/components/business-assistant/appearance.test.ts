import { describe, expect, it } from "vitest";
import { appearanceStorageKey, assistantActivity, defaultAppearance, parseAppearance } from "./appearance";

describe("personal assistant appearance", () => {
  it.each([null, "bad JSON", "null", "[]", "42", '{"name":" ","avatar":"https://untrusted.test/avatar"}'])("safely reads invalid storage: %s", raw => {
    expect(parseAppearance(raw)).toEqual(defaultAppearance);
  });
  it("accepts only cosmetic preferences and bounds the displayed name", () => {
    expect(parseAppearance(JSON.stringify({ name: "  Luna  ", avatar: "mint", token: "not-identity", busy: true }))).toEqual({ name: "Luna", avatar: "mint" });
    expect(parseAppearance(JSON.stringify({ name: "x".repeat(100), avatar: "lilac" })).name).toHaveLength(32);
  });
  it("namespaces preferences by both authenticated user and business without separator collisions", () => {
    const keys = [appearanceStorageKey("u1", "b1"), appearanceStorageKey("u2", "b1"), appearanceStorageKey("u1", "b2"), appearanceStorageKey("u:b", "c"), appearanceStorageKey("u", "b:c")];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("existing conversation activity projection", () => {
  it.each([
    [true, false, false, "available"],
    [true, true, false, "working"],
    [true, false, true, "approval"],
    [true, true, true, "working"],
    [false, false, false, "offline"],
    [false, true, true, "offline"],
  ] as const)("online=%s busy=%s awaiting=%s → %s", (online, busy, awaiting, kind) => {
    expect(assistantActivity(online, busy, awaiting).kind).toBe(kind);
  });
});
