import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), admin: vi.fn(), settings: { staff_allowed: true } }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: async () => ({ id: "owner" }),
  requireBusinessAccess: async () => ({ admin: false, business: { id: "business" } }),
  isPlatformAdmin: m.admin,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => m }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveActionPolicy, saveBusinessActionSettings } from "./manage";
beforeEach(() => {
  vi.clearAllMocks(); m.admin.mockResolvedValue(true); m.rpc.mockResolvedValue({ error: null });
  m.settings = { staff_allowed: true };
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "business_users" ? { role: "owner" } : m.settings, error: null }) };
    return q;
  });
});
it("preserves existing staff access when the owner edits invitation settings", async () => {
  const form = new FormData();
  form.set("action_key", "business.provision"); form.set("invitation_days", "7");
  expect(await saveBusinessActionSettings("shop", form)).toHaveProperty("success");
  expect(m.rpc).toHaveBeenCalledWith("save_business_action_settings", expect.objectContaining({ p_staff: true, p_business: "business", p_user: "owner" }));
});
it("ignores a forged staff checkbox instead of granting access", async () => {
  m.settings = { staff_allowed: false };
  const form = new FormData(); form.set("action_key", "business.provision"); form.set("staff_allowed", "on");
  await saveBusinessActionSettings("shop", form);
  expect(m.rpc).toHaveBeenCalledWith("save_business_action_settings", expect.objectContaining({ p_staff: false }));
});
it("lets only the administrator change module policies using the existing policy RPC", async () => {
  const form = new FormData(); form.set("scope", "business"); form.set("target", "business");
  form.set("action_key", "module.products"); form.set("enabled", "false");
  m.admin.mockResolvedValue(false);
  expect(await saveActionPolicy(form)).toHaveProperty("error"); expect(m.rpc).not.toHaveBeenCalled();
  m.admin.mockResolvedValue(true);
  expect(await saveActionPolicy(form)).toHaveProperty("success");
  expect(m.rpc).toHaveBeenCalledWith("save_action_policy", expect.objectContaining({ p_user: "owner", p_action: "module.products", p_enabled: false }));
  m.rpc.mockClear(); form.set("action_key", "module.unknown");
  expect(await saveActionPolicy(form)).toHaveProperty("error"); expect(m.rpc).not.toHaveBeenCalled();
});
it.each([true, false])("saves package checkboxes as explicit permissions: %s", async checked => {
  const form = new FormData();
  form.set("scope", "plan"); form.set("target", "starter");
  form.set("action_key", "module.products"); form.set("checkbox_mode", "true");
  if (checked) form.set("enabled", "true");
  expect(await saveActionPolicy(form)).toHaveProperty("success");
  expect(m.rpc).toHaveBeenCalledWith("save_action_policy", expect.objectContaining({ p_enabled: checked, p_scope: "plan", p_target: "starter" }));
});
