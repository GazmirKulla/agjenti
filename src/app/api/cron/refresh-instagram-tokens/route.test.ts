import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: [] as { values: Record<string, unknown>; filters: unknown[][] }[], check: vi.fn(), refresh: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const filters: unknown[][] = [];
  let values: Record<string, unknown> | null = null;
  const chain = {
    select: () => chain,
    update: (v: Record<string, unknown>) => { values = v; m.updates.push({ values: v, filters }); return chain; },
    eq: (...f: unknown[]) => { filters.push(f); return chain; },
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(values ? { error: null } : { data: m.rows, error: null }).then(resolve),
  };
  return chain;
} }) }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: (v: string) => `plain-${v}`, encryptSecret: (v: string) => `sealed-${v}` }));
vi.mock("@/lib/instagram/oauth", () => ({ refreshLongLivedToken: m.refresh, graphVersion: () => "v22.0" }));
vi.mock("@/lib/instagram/token-health", async (original) => ({ ...(await original<typeof import("@/lib/instagram/token-health")>()), checkInstagramToken: m.check }));
vi.mock("@/lib/tracking/system-events", async (original) => ({ ...(await original<typeof import("@/lib/tracking/system-events")>()), recordSystem: m.record, stepFailure: () => "refresh:unexpected", trackScheduledJob: (_job: string, work: () => Promise<Response>) => work() }));
import { GET } from "./route";

const day = 86400000;
const row = (id: string, expiresInDays: number) => ({ id, business_id: `business-${id}`, ig_user_id: `ig-${id}`, access_token_ciphertext: id, expires_at: new Date(Date.now() + expiresInDays * day).toISOString(), refreshed_at: new Date(Date.now() - 3 * day).toISOString(), status: "connected" });
const run = () => GET(new Request("https://agjenti.test/api/cron/refresh-instagram-tokens", { headers: { authorization: "Bearer cron" } }));

beforeEach(() => {
  process.env.CRON_SECRET = "cron";
  m.updates = []; m.check.mockReset(); m.refresh.mockReset(); m.record.mockReset();
});

describe("daily Instagram token job", () => {
  it("marks a token Meta rejected as expired even far from its expiry, and does not refresh it", async () => {
    m.rows = [row("filiz", 40)];
    m.check.mockResolvedValue({ valid: false, error: { code: 190, error_subcode: 460 } });
    expect((await run()).status).toBe(200);
    expect(m.check).toHaveBeenCalledWith("ig-filiz", "plain-filiz");
    expect(m.updates).toEqual([{ values: expect.objectContaining({ status: "expired", last_error: "token_rejected: meta_190_460" }), filters: [["id", "filiz"], ["status", "connected"]] }]);
    expect(m.record).toHaveBeenCalledWith("system.instagram_token", "token_rejected", expect.objectContaining({ businessId: "business-filiz", reason: "check:meta_190_460" }));
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("leaves a valid token far from expiry untouched and an unknown answer connected", async () => {
    m.rows = [row("ok", 40), row("unknown", 40)];
    m.check.mockResolvedValueOnce({ valid: true }).mockResolvedValueOnce({ valid: null });
    await run();
    expect(m.updates).toEqual([]);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("still refreshes a valid token close to its expiry and keeps a webhook subscription error", async () => {
    m.rows = [row("soon", 3)];
    m.check.mockResolvedValue({ valid: true });
    m.refresh.mockResolvedValue({ accessToken: "next", expiresAt: new Date(Date.now() + 60 * day) });
    await run();
    expect(m.updates[0].values).toMatchObject({ access_token_ciphertext: "sealed-next", status: "connected" });
    // Only the refresh's own error is cleared.
    expect(m.updates[1]).toEqual({ values: { last_error: null }, filters: [["id", "soon"], ["last_error", "refresh_failed"]] });
    expect(m.record).toHaveBeenCalledWith("system.instagram_token", "refreshed", expect.anything());
  });

  it("refuses a call without the scheduler's secret", async () => {
    m.rows = [row("filiz", 40)];
    expect((await GET(new Request("https://agjenti.test/api/cron/refresh-instagram-tokens"))).status).toBe(401);
    expect(m.check).not.toHaveBeenCalled();
  });
});
