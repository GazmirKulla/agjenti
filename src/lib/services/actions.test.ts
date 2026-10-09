import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  profile: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  throwOnError: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: m.user,
  requireBusinessAccess: m.access,
}));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadDashboardProfile: m.profile,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveBusinessService } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "user" });
  m.access.mockResolvedValue({ business: { id: "business" } });
  m.profile.mockResolvedValue({ enabledModules: ["services"] });
  const chain = {
    update: m.update,
    eq: m.eq,
    select: m.select,
    maybeSingle: m.maybeSingle,
    insert: m.insert,
    throwOnError: m.throwOnError,
  };
  for (const fn of [m.from, m.update, m.eq, m.select, m.insert])
    fn.mockReturnValue(chain);
  m.maybeSingle.mockResolvedValue({ data: { id: "service" } });
  m.throwOnError.mockResolvedValue({});
});
function form() {
  const f = new FormData();
  f.set("name", "Konsultë");
  f.set("active", "on");
  return f;
}
it("rejects foreign business and disabled service module before writes", async () => {
  m.access.mockResolvedValue(null);
  expect(await saveBusinessService("foreign", form())).toHaveProperty("error");
  expect(m.from).not.toHaveBeenCalled();
  m.access.mockResolvedValue({ business: { id: "business" } });
  m.profile.mockResolvedValue({ enabledModules: ["bookings"] });
  expect(await saveBusinessService("demo", form())).toHaveProperty("error");
  expect(m.from).not.toHaveBeenCalled();
});
it("creates a service without needing the booking module", async () => {
  expect(await saveBusinessService("demo", form())).toHaveProperty("success");
  expect(m.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      business_id: "business",
      booking_enabled: false,
    }),
  );
});
it("scopes edits to the business and rejects stale changes", async () => {
  const f = form();
  f.set("id", "11111111-1111-4111-8111-111111111111");
  f.set("updatedAt", "2026-10-10T00:00:00Z");
  m.maybeSingle.mockResolvedValue({ data: null });
  expect(await saveBusinessService("demo", f)).toEqual({
    error: "Shërbimi ndryshoi. Rifresko faqen para ruajtjes.",
  });
  expect(m.eq).toHaveBeenCalledWith("business_id", "business");
  expect(m.eq).toHaveBeenCalledWith("updated_at", "2026-10-10T00:00:00Z");
});
