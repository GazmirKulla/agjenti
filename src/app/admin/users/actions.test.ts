import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), service: vi.fn(), create: vi.fn(), update: vi.fn(), from: vi.fn(), revalidate: vi.fn(), auditInsert: vi.fn(), auditFinish: vi.fn(), memberInsert: vi.fn(), business: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.session, isPlatformAdmin: m.admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: m.service }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
const restore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/account/deletion", () => ({ restoreAccountDeletion: restore }));
import { manageUser } from "./actions";
const userId = "f0f5b4a3-2100-4000-8000-000000000001";
function form(action = "create", overrides: Record<string, string | undefined> = {}) {
  const data = new FormData();
  Object.entries({ action, user_id: userId, name: "Test User", email: "TEST@example.com", password: "Example-password-2026", password_confirm: "Example-password-2026", verified: "on", ...overrides }).forEach(([k, v]) => { if (v !== undefined) data.set(k, v); });
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ id: userId }); m.admin.mockResolvedValue(true);
  m.create.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  m.update.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  m.auditInsert.mockResolvedValue({ data: { id: "receipt" }, error: null });
  m.auditFinish.mockResolvedValue({ error: null }); m.memberInsert.mockResolvedValue({ error: null });
  m.business.mockResolvedValue({ data: { id: userId }, error: null });
  m.from.mockImplementation((table: string) => {
    if (table === "platform_user_events") return {
      insert: (payload: unknown) => ({ select: () => ({ single: () => m.auditInsert(payload) }) }),
      update: (payload: unknown) => ({ eq: () => m.auditFinish(payload) }),
    };
    if (table === "businesses") return { select: () => ({ eq: () => ({ maybeSingle: m.business }) }) };
    if (table === "business_users") return { insert: m.memberInsert };
    throw new Error("Unexpected table");
  });
  m.service.mockReturnValue({ from: m.from, auth: { admin: { createUser: m.create, updateUserById: m.update } } });
});
it.each([null, { id: userId }])("blocks unauthenticated and non-admin callers before service access", async session => {
  m.session.mockResolvedValue(session); m.admin.mockResolvedValue(false);
  expect(await manageUser(form())).toHaveProperty("error"); expect(m.service).not.toHaveBeenCalled();
});
it.each([{ password: "short", password_confirm: "short" }, { password_confirm: "different" }, { email: "invalid" }, { action: "delete" }, { business_id: userId, role: "admin" }])("rejects invalid input before mutations: %j", async overrides => {
  expect(await manageUser(form("create", overrides))).toHaveProperty("error"); expect(m.create).not.toHaveBeenCalled(); expect(m.auditInsert).not.toHaveBeenCalled();
});
it("creates a confirmed account without invitation and never records passwords", async () => {
  expect(await manageUser(form())).toHaveProperty("success");
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.com", email_confirm: true, user_metadata: { full_name: "Test User" } }));
  expect(m.auditInsert).toHaveBeenCalledWith({ actor_id: userId, target_id: expect.any(String), action: "create" });
  expect(m.auditFinish).toHaveBeenCalledWith({ status: "completed" });
});
it("can create an unverified account", async () => {
  await manageUser(form("create", { verified: "" }));
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
});
it("verifies email without a password update", async () => {
  expect(await manageUser(form("verify_email", { password: "", password_confirm: "" }))).toHaveProperty("success");
  expect(m.update).toHaveBeenCalledWith(userId, { email_confirm: true });
});
it("changes only the password of the selected user", async () => {
  await manageUser(form("password"));
  expect(m.update).toHaveBeenCalledWith(userId, { password: "Example-password-2026" });
});
it("restores a pending deletion without requiring a password", async () => {
  restore.mockResolvedValue({ error: null });
  expect(await manageUser(form("restore", { password: "", password_confirm: "" }))).toEqual({ success: expect.stringContaining("rikthye") });
  expect(restore).toHaveBeenCalledWith(userId);
  expect(m.auditInsert).toHaveBeenCalledWith({ actor_id: userId, target_id: userId, action: "restore" });
  expect(m.update).not.toHaveBeenCalled();
});
it("explains when there is no deletion to restore", async () => {
  restore.mockResolvedValue({ error: { code: "not_scheduled" } });
  expect(await manageUser(form("restore"))).toEqual({ error: expect.stringContaining("nuk ka fshirje") });
  expect(m.auditFinish).toHaveBeenCalledWith({ status: "failed" });
});
it("does not change Auth when the audit store is unavailable", async () => {
  m.auditInsert.mockResolvedValue({ data: null, error: {} });
  expect(await manageUser(form())).toHaveProperty("error"); expect(m.create).not.toHaveBeenCalled();
});
it("reports duplicate email without claiming success or adding membership", async () => {
  m.create.mockResolvedValue({ error: { code: "email_exists" } });
  expect(await manageUser(form("create", { business_id: userId }))).toEqual({ error: expect.stringContaining("tashmë") });
  expect(m.memberInsert).not.toHaveBeenCalled(); expect(m.auditFinish).toHaveBeenCalledWith({ status: "failed" });
});
it("reports partial success when business membership fails", async () => {
  m.memberInsert.mockResolvedValue({ error: {} });
  expect(await manageUser(form("create", { business_id: userId }))).toEqual({ error: expect.stringContaining("Llogaria u krijua") });
  expect(m.revalidate).toHaveBeenCalledWith("/admin/users");
});
it("does not hide a completed Auth update when the receipt update fails", async () => {
  m.auditFinish.mockResolvedValue({ error: {} });
  expect(await manageUser(form("password"))).toEqual({ error: expect.stringContaining("Ndryshimi u krye") });
});
