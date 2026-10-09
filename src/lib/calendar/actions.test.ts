import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  profile: vi.fn(),
  from: vi.fn(),
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
import {
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
  expect(await disconnectGoogleCalendar("foreign")).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not permit writes after the bookings module is disabled", async () => {
  mocks.access.mockResolvedValue({ business: { id: "business" } });
  mocks.profile.mockResolvedValue({ enabledModules: [] });
  expect(await saveBooking("demo", new FormData())).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
