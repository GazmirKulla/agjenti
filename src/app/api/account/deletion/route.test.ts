import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), permitted: vi.fn(), schedule: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({
  getRequestUser: m.user,
  permittedWrite: m.permitted,
  bearerToken: (request: Request) => request.headers.get("authorization")?.slice(7),
}));
vi.mock("@/lib/account/deletion", () => ({ scheduleAccountDeletion: m.schedule }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getSession: m.session } }),
}));
import { POST } from "./route";

const req = (body: unknown, bearer = true) =>
  new Request("https://app.test/api/account/deletion", {
    method: "POST",
    headers: bearer ? { authorization: "Bearer native-token" } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.permitted.mockReturnValue(true);
  m.user.mockResolvedValue({ id: "user" });
  m.schedule.mockResolvedValue({ ok: true, purgeAfter: "2026-12-06T00:00:00Z" });
  m.session.mockResolvedValue({ data: { session: { access_token: "cookie-token" } } });
});
it("rejects cross-site writes and anonymous callers before scheduling", async () => {
  m.permitted.mockReturnValue(false);
  expect((await POST(req({ confirm: true }))).status).toBe(403);
  m.permitted.mockReturnValue(true);
  m.user.mockResolvedValue(null);
  expect((await POST(req({ confirm: true }))).status).toBe(401);
  expect(m.schedule).not.toHaveBeenCalled();
});
it.each([{}, { confirm: "true" }, "not-json"])("requires explicit confirmation: %j", async body => {
  expect((await POST(req(body))).status).toBe(400);
  expect(m.schedule).not.toHaveBeenCalled();
});
it("schedules with the native token", async () => {
  const response = await POST(req({ confirm: true }));
  expect(await response.json()).toEqual({ scheduled: true, purgeAfter: "2026-12-06T00:00:00Z" });
  expect(m.schedule).toHaveBeenCalledWith("user", "native-token");
});
it("uses the cookie session token for web requests", async () => {
  await POST(req({ confirm: true }, false));
  expect(m.schedule).toHaveBeenCalledWith("user", "cookie-token");
});
it("reports refusals without claiming success", async () => {
  m.schedule.mockResolvedValue({ ok: false, status: 403, error: "admin" });
  const response = await POST(req({ confirm: true }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "admin" });
});
