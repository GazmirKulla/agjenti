import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/tracking/system-events", async (original) => ({ ...(await original<typeof import("@/lib/tracking/system-events")>()), recordSystem: m.record }));
import { checkInstagramToken, isRejectedToken, markInstagramTokenRejected, rejectedTokenError } from "./token-health";

const rejected = { error: { message: "Error validating access token", type: "OAuthException", code: 190, error_subcode: 460 } };
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => m.record.mockReset());

describe("a token Meta rejected", () => {
  it("is Graph error 190 only", () => {
    expect(isRejectedToken({ code: 190, error_subcode: 463 })).toBe(true);
    expect(isRejectedToken({ code: 10 })).toBe(false);
    expect(isRejectedToken(null)).toBe(false);
    expect(rejectedTokenError({ code: 190, error_subcode: 460 })).toBe("token_rejected: meta_190_460");
  });

  it("is found by a read-only call with the token", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(rejected, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect(await checkInstagramToken("1784", "token")).toEqual({ valid: false, error: rejected.error });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/graph\.instagram\.com\/v[\d.]+\/1784\?fields=username$/);
    expect(init.headers.Authorization).toBe("Bearer token");
    expect(init.method).toBeUndefined();
  });

  it("is not assumed from an answer that says nothing about the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ username: "shop" })));
    expect(await checkInstagramToken("1784", "token")).toEqual({ valid: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: 4, message: "rate" } }, { status: 400 })));
    expect(await checkInstagramToken("1784", "token")).toEqual({ valid: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    expect(await checkInstagramToken("1784", "token")).toEqual({ valid: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await checkInstagramToken("1784", "token")).toEqual({ valid: null });
  });

  it("turns only a connected row into expired, with a clear error, and records it", async () => {
    const calls: unknown[] = [];
    const chain = { update: (v: unknown) => { calls.push(["update", v]); return chain; }, eq: (...v: unknown[]) => { calls.push(["eq", ...v]); return chain; },
      then: (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f) };
    const db = { from: (table: string) => { calls.push(["from", table]); return chain; } } as unknown as Parameters<typeof markInstagramTokenRejected>[0];
    await markInstagramTokenRejected(db, { id: "connection", businessId: "business" }, "check", rejected.error);
    expect(calls).toContainEqual(["from", "instagram_connections"]);
    expect(calls).toContainEqual(["update", expect.objectContaining({ status: "expired", last_error: "token_rejected: meta_190_460" })]);
    expect(calls).toContainEqual(["eq", "id", "connection"]);
    expect(calls).toContainEqual(["eq", "status", "connected"]);
    expect(m.record).toHaveBeenCalledWith("system.instagram_token", "token_rejected", { businessId: "business", reason: "check:meta_190_460", ref: "connection" });
  });
});
