import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cookieUser: vi.fn(), bearerUser: vi.fn(), member: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: m.cookieUser } }) }));
vi.mock("@/lib/auth/request", async (original) => ({ ...await original<typeof import("@/lib/auth/request")>(), bearerClient: () => ({ auth: { getUser: m.bearerUser } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, maybeSingle: table === "business_users" ? m.member : m.admin };
  return q;
} }) }));
import { transportAccess } from "./transport-access";
const business = "10000000-0000-4000-8000-000000000001";
const request = (authorization?: string) => new Request("https://agjenti.test", authorization ? { headers: { authorization } } : undefined);
beforeEach(() => {
  vi.clearAllMocks();
  m.cookieUser.mockResolvedValue({ data: { user: { id: "cookie-user" } }, error: null });
  m.bearerUser.mockResolvedValue({ data: { user: { id: "native-user" } }, error: null });
  m.member.mockResolvedValue({ data: { user_id: "x" }, error: null });
  m.admin.mockResolvedValue({ data: null, error: null });
});
it("accepts the native bearer identity for a current member", async () => {
  expect(await transportAccess(business, request("Bearer good.token"))).toMatchObject({ userId: "native-user" });
  expect(m.cookieUser).not.toHaveBeenCalled();
});
it("never falls back to cookies when an Authorization header is invalid or rejected", async () => {
  expect(await transportAccess(business, request("Basic abc"))).toBeNull();
  m.bearerUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
  expect(await transportAccess(business, request("Bearer expired.token"))).toBeNull();
  expect(m.cookieUser).not.toHaveBeenCalled();
});
it("keeps cookie identity for browser requests and refuses non-members", async () => {
  expect(await transportAccess(business, request())).toMatchObject({ userId: "cookie-user" });
  m.member.mockResolvedValueOnce({ data: null, error: null });
  expect(await transportAccess(business, request())).toBeNull();
  expect(await transportAccess("not-a-uuid", request())).toBeNull();
});
