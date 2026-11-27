import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  profile: vi.fn(),
  from: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  requireBusinessAccess: mocks.access,
}));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadDashboardProfile: mocks.profile,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./service", async original => ({ ...(await original<typeof import("./service")>()), persistBooking: mocks.persist }));
import {
  changeBooking,
  readCalendarEvents,
  saveBooking,
  saveCalendarSettings,
  disconnectGoogleCalendar,
} from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.access.mockResolvedValue(null);
});
it("rejects all mutations in another business before touching data", async () => {
  for (const action of [saveBooking, saveCalendarSettings])
    expect(await action("foreign", new FormData())).toEqual({
      error: "Nuk ke qasje në këtë biznes.",
    });
  expect(await changeBooking("foreign", { id: booking.id, revision: 1, status: "confirmed" })).toEqual({ error: "Nuk ke qasje në këtë biznes." });
  await expect(readCalendarEvents("foreign", "2026-11-23T00:00:00Z", "2026-11-30T00:00:00Z")).rejects.toThrow();
  expect(await disconnectGoogleCalendar("foreign")).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not permit writes after the bookings module is disabled", async () => {
  mocks.access.mockResolvedValue({ business: { id: "business" } });
  mocks.profile.mockResolvedValue({ enabledModules: [] });
  expect(await saveBooking("demo", new FormData())).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});

const booking = {
  id: "0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d", service_id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", service_name: "Konsultë",
  customer_name: "Ana", customer_contact: "+355690000000", starts_at: "2026-12-02T09:00:00.000Z", ends_at: "2026-12-02T09:30:00.000Z",
  blocked_until: "2026-12-02T09:30:00.000Z", status: "pending", notes: "Hyrja anësore", sync_status: "local",
  google_event_id: null, google_calendar_id: null, revision: 3,
};
/** A Supabase query that resolves to one row, whatever filters are chained. */
function rows(byTable: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: byTable[table] ?? null, error: null }) };
    return query;
  });
}
function allowed() {
  mocks.access.mockResolvedValue({ business: { id: "business" } });
  mocks.profile.mockResolvedValue({ enabledModules: ["bookings"] });
  rows({ bookings: booking, business_calendar_settings: { timezone: "Europe/Tirane" } });
  mocks.persist.mockImplementation(async (_id: string, input: { status: string }) => ({ booking: { ...booking, status: input.status }, syncError: null }));
}
it("confirms a pending booking with its stored details unchanged", async () => {
  allowed();
  expect(await changeBooking("demo", { id: booking.id, revision: 3, status: "confirmed" })).toEqual({ success: "Rezervimi u konfirmua." });
  expect(mocks.persist).toHaveBeenCalledWith("business", { id: booking.id, revision: 3, serviceId: booking.service_id, name: "Ana",
    contact: "+355690000000", notes: "Hyrja anësore", start: booking.starts_at, status: "confirmed" });
});
it("moves a booking to the dropped wall-clock time in the business's zone, keeping its status", async () => {
  allowed();
  expect(await changeBooking("demo", { id: booking.id, revision: 3, date: "2026-12-03", time: "14:15" })).toEqual({ success: "Rezervimi u zhvendos." });
  expect(mocks.persist.mock.calls[0][1]).toMatchObject({ start: "2026-12-03T13:15:00.000Z", status: "pending" });
});
it("refuses a change made on an older version of the booking or on a cancelled one", async () => {
  allowed();
  expect(await changeBooking("demo", { id: booking.id, revision: 2, status: "confirmed" })).toHaveProperty("error");
  rows({ bookings: { ...booking, status: "cancelled" }, business_calendar_settings: { timezone: "Europe/Tirane" } });
  expect(await changeBooking("demo", { id: booking.id, revision: 3, status: "confirmed" })).toEqual({ error: "Rezervimi është anuluar." });
  expect(mocks.persist).not.toHaveBeenCalled();
});
it("accepts either a decision or a new time, never both or neither", async () => {
  allowed();
  for (const change of [{ id: booking.id, revision: 3 }, { id: booking.id, revision: 3, status: "confirmed" as const, date: "2026-12-03", time: "10:00" },
    { id: "not-a-uuid", revision: 3, status: "confirmed" as const }])
    expect(await changeBooking("demo", change)).toEqual({ error: "Ndryshimi i rezervimit është i pavlefshëm." });
  expect(mocks.persist).not.toHaveBeenCalled();
});
