import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), calls: [] as { table: string; filters: unknown[][] }[], responses: {} as Record<string, unknown[]> }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { loadManagementSummary } from "./management-summary";
beforeEach(() => {
  m.calls = []; m.responses = {}; m.from.mockReset();
  m.from.mockImplementation((table: string) => {
    const filters: unknown[][] = []; m.calls.push({ table, filters });
    const response = m.responses[table]?.shift() ?? { data: [], count: 0, error: null };
    const q: Record<string, unknown> = { then: (resolve: (r: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(response).then(resolve, reject) };
    for (const method of ["select", "eq", "in", "gte", "order", "limit", "maybeSingle"]) q[method] = (...args: unknown[]) => { filters.push([method, ...args]); return q; };
    return q;
  });
});
it("does not query modules the business cannot access", async () => {
  expect(await loadManagementSummary("tenant", ["products"])).toEqual({ orders: null, bookings: null });
  expect(m.from).not.toHaveBeenCalled();
});
it("scopes every query to the verified business and links future bookings to their local day", async () => {
  m.responses.orders = [{ count: 3, error: null }, { count: 2, error: null }];
  m.responses.bookings = [{ data: [{ id: "b1", customer_name: "Fixture", service_name: "Service", starts_at: "2026-11-04T23:30:00Z", status: "pending" }], error: null }];
  m.responses.business_calendar_settings = [{ data: { timezone: "Europe/Tirane" }, error: null }];
  const now = new Date("2026-11-04T10:00:00Z");
  const result = await loadManagementSummary("tenant-a", ["orders", "bookings"], now);
  expect(result.orders).toEqual({ confirmed: 3, review: 2 });
  expect(result.bookings?.items[0].date).toBe("2026-11-05");
  for (const call of m.calls) expect(call.filters).toContainEqual(["eq", "business_id", "tenant-a"]);
  expect(m.calls.find(c => c.table === "bookings")?.filters).toEqual(expect.arrayContaining([
    ["gte", "starts_at", now.toISOString()], ["in", "status", ["pending", "confirmed"]], ["limit", 5],
  ]));
});
it("keeps failed counts unavailable rather than displaying zero; other sections still load", async () => {
  m.responses.orders = [{ count: null, error: { message: "offline" } }, { count: 0, error: null }];
  m.responses.business_calendar_settings = [{ data: null, error: null }];
  const result = await loadManagementSummary("tenant", ["orders", "bookings"]);
  expect(result.orders).toBeNull();
  expect(result.bookings).toEqual({ items: [], timezone: "Europe/Tirane" });
});
it("does not invent local booking dates when the timezone cannot be read", async () => {
  m.responses.business_calendar_settings = [{ data: null, error: { message: "offline" } }];
  expect((await loadManagementSummary("tenant", ["bookings"])).bookings).toBeNull();
});
