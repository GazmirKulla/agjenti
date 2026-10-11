import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), member: true, writeError: false }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: m.user } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: m.admin }));
import { POST } from "./route";

const context = { params: Promise.resolve({ id: "business-a" }) };
function request(accept = "application/json", origin = "https://app.test") {
  return new Request("https://app.test/api/businesses/business-a/instagram/disconnect", { method: "POST", headers: { accept, origin } });
}
beforeEach(() => {
  vi.clearAllMocks(); m.member = true; m.writeError = false;
  m.user.mockResolvedValue({ data: { user: { id: "user-a" } } });
  m.admin.mockResolvedValue(false);
  m.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { m.eq(table, field, value); return query; },
      update: (value: unknown) => { m.update(value); return query; },
      neq: async () => ({ error: m.writeError ? { message: "database failure" } : null }),
      maybeSingle: async () => ({ data: table === "business_users" ? m.member ? { user_id: "user-a" } : null : { slug: "shop" } }),
    };
    return query;
  });
});
it("rejects cross-origin requests before accessing connections", async () => {
  expect((await POST(request("application/json", "https://other.test"), context)).status).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
});
it("requires authentication and membership before disconnecting", async () => {
  m.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await POST(request(), context)).status).toBe(401);
  m.member = false;
  expect((await POST(request(), context)).status).toBe(403);
  expect(m.update).not.toHaveBeenCalled();
});
it("returns confirmed success to the card and scopes the write to its business", async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(m.eq).toHaveBeenCalledWith("instagram_connections", "business_id", "business-a");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "disconnected" }));
});
it("does not report success or redirect when the write fails", async () => {
  m.writeError = true;
  for (const accept of ["application/json", "text/html"]) {
    const response = await POST(request(accept), context);
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
  }
});
it("preserves the existing detail-page form redirect", async () => {
  const response = await POST(request("text/html"), context);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://app.test/b/shop/instagram?disconnected=1");
});
