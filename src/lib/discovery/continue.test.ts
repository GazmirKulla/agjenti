import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("./queue", () => ({ runDiscoveryQueue: vi.fn() }));
import { continueDiscovery, MAX_HOPS } from "./continue";

afterEach(() => vi.unstubAllEnvs());
const business = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
function deps(due: number | null) {
  return {
    run: vi.fn(async () => 1), dueIn: vi.fn(async () => due), sleep: vi.fn(async () => {}),
    fetcher: vi.fn(async () => new Response(null, { status: 202 })),
  };
}

it("hands the rest of a scan to the next call of the worker", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  const d = deps(0);
  expect(await continueDiscovery(business, "https://agjenti.app", 2, d)).toBe(true);
  const [url, init] = d.fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe(`https://agjenti.app/api/cron/business-discovery?business=${business}&hop=3`);
  expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer secret" } });
  expect(d.sleep).not.toHaveBeenCalled();
});

it("waits for a retry that is due soon", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  const d = deps(30_000);
  expect(await continueDiscovery(business, "https://agjenti.app", 0, d)).toBe(true);
  expect(d.sleep).toHaveBeenCalledWith(30_500);
});

it("stops when nothing is left, the retry is far away, hops run out or it cannot call itself", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  for (const [due, hop, origin] of [[null, 0, "https://a.app"], [120_000, 0, "https://a.app"], [0, MAX_HOPS - 1, "https://a.app"], [0, 0, null]] as const) {
    const d = deps(due);
    expect(await continueDiscovery(business, origin, hop, d)).toBe(false);
    expect(d.fetcher).not.toHaveBeenCalled();
  }
  vi.stubEnv("CRON_SECRET", "");
  const d = deps(0);
  expect(await continueDiscovery(business, "https://a.app", 0, d)).toBe(false);
});
