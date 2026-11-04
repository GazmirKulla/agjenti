import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), bearer: vi.fn(), from: vi.fn(), member: true, error: false }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user }));
vi.mock("@/lib/auth/request", () => ({ bearerClient: () => ({ auth: { getUser: m.bearer } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { operationActor } from "./access";
beforeEach(() => {
  vi.clearAllMocks(); m.member = true; m.error = false;
  m.user.mockResolvedValue({ id: "owner" }); m.bearer.mockResolvedValue({ data: { user: { id: "mobile" } } });
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: m.error ? {} : null, data: table === "businesses" ? { id: "business" } : table === "business_users" && m.member ? { role: "owner" } : null }) }; return q;
  });
});
it("uses the verified mobile bearer identity without relying on browser cookies", async () => {
  expect((await operationActor("business", "mobile", "token")).userId).toBe("mobile");
  expect(m.user).not.toHaveBeenCalled();
});
it("never falls back to cookies after a rejected bearer credential", async () => {
  m.bearer.mockResolvedValue({ data: { user: null } });
  await expect(operationActor("business", "owner", "bad-token")).rejects.toThrow("Sesioni");
  expect(m.user).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
});
it("denies revoked memberships and unreadable authorization state", async () => {
  m.member = false; await expect(operationActor("business", "owner")).rejects.toThrow("qasje");
  m.member = true; m.error = true; await expect(operationActor("business", "owner")).rejects.toThrow("qasje");
});
