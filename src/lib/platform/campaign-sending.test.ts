import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), update: vi.fn(), result: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, isPlatformAdmin: m.admin }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/ai/model-choice", () => ({ loadModelTiers: vi.fn(), clearModelChoiceCache: vi.fn(), verifyModel: vi.fn(), MODEL_PATTERN: /./ }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: (table: string) => ({
      update: (values: unknown) => {
        m.update(table, values);
        return { eq: () => ({ select: () => ({ maybeSingle: m.result }) }) };
      },
    }),
  }),
}));
import { saveCampaignSending } from "./actions";

const form = (on: boolean) => { const f = new FormData(); if (on) f.set("campaigns_enabled", "on"); return f; };
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "admin-id" });
  m.admin.mockResolvedValue(true);
});

it("only platform admins can change campaign sending", async () => {
  m.user.mockResolvedValue(null);
  expect((await saveCampaignSending(form(true))).error).toBeTruthy();
  m.user.mockResolvedValue({ id: "owner" });
  m.admin.mockResolvedValue(false);
  expect((await saveCampaignSending(form(true))).error).toBeTruthy();
  expect(m.update).not.toHaveBeenCalled();
});

it("turns sending on and off and reports the stored state", async () => {
  m.result.mockResolvedValue({ data: { enabled: true }, error: null });
  expect((await saveCampaignSending(form(true))).success).toContain("aktivizua");
  expect(m.update).toHaveBeenLastCalledWith("marketing_control", { enabled: true });
  m.result.mockResolvedValue({ data: { enabled: false }, error: null });
  expect((await saveCampaignSending(form(false))).success).toContain("çaktivizua");
  expect(m.update).toHaveBeenLastCalledWith("marketing_control", { enabled: false });
  expect(m.revalidate).toHaveBeenCalledWith("/admin/settings");
});

it("does not claim success when the switch was not stored", async () => {
  m.result.mockResolvedValue({ data: null, error: null });
  expect((await saveCampaignSending(form(true))).error).toBeTruthy();
  m.result.mockResolvedValue({ data: null, error: { code: "PGRST205" } });
  expect((await saveCampaignSending(form(true))).error).toContain("migrimi");
  expect(m.revalidate).not.toHaveBeenCalled();
});
