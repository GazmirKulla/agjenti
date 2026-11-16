import { afterEach, beforeEach, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/conversations/avatar-backfill", () => ({ runAvatarBackfill: run }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { GET } from "./route";

const call = (auth?: string) => GET(new Request("https://app.test/api/cron/participant-avatars", { headers: auth ? { authorization: auth } : {} }));
beforeEach(() => { vi.stubEnv("CRON_SECRET", "cron-secret"); run.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

it("runs only for the scheduler's secret", async () => {
  expect((await call()).status).toBe(401);
  expect((await call("Bearer wrong")).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
  run.mockResolvedValue({ candidates: 1, stored: 1, none: 0, skipped: 0, unreachable: 0 });
  const res = await call("Bearer cron-secret");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, stored: 1 });
});

it("reports a failed run so it is visible, without leaking details", async () => {
  run.mockRejectedValue(new Error("Avatar candidates unavailable"));
  const res = await call("Bearer cron-secret");
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ ok: false });
});
