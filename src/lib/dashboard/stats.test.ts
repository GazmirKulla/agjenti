import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => mocks,
}));
import { getDashboardStats } from "./stats";
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T23:15:00Z"));
});
it("uses one aggregate request scoped to the authorized business", async () => {
  const data = { conversations: 25, orders: 2, trend: [] };
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect(await getDashboardStats("tenant-a")).toEqual(data);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("dashboard_stats", {
    p_business_id: "tenant-a",
    p_start: "2026-09-28T00:00:00.000Z",
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("requests platform totals only when no business is supplied", async () => {
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  await getDashboardStats();
  expect(mocks.rpc).toHaveBeenCalledWith(
    "dashboard_stats",
    expect.objectContaining({ p_business_id: null }),
  );
});
it("retains exact counts and UTC buckets before the migration is installed", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  const calls: { table: string; filters: unknown[][] }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const call = { table, filters: [] as unknown[][] };
    calls.push(call);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lt: vi.fn(),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve({ count: 3, error: null }).then(resolve),
    };
    query.select.mockReturnValue(query);
    for (const key of ["eq", "gte", "lt"] as const)
      query[key].mockImplementation((...args: unknown[]) => {
        call.filters.push([key, ...args]);
        return query;
      });
    return query;
  });
  const result = await getDashboardStats("tenant-a");
  expect(result.conversations).toBe(3);
  expect(result.trend).toHaveLength(7);
  expect(result.trend[0]).toEqual({
    date: "2026-09-28T00:00:00.000Z",
    conversations: 3,
    orders: 3,
  });
  expect(
    calls.every((c) =>
      c.filters.some(
        (f) => f[0] === "eq" && f[1] === "business_id" && f[2] === "tenant-a",
      ),
    ),
  ).toBe(true);
});
it("does not fall back on permission or database errors", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  await expect(getDashboardStats("tenant-a")).rejects.toThrow();
  expect(mocks.from).not.toHaveBeenCalled();
});
