import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  upsert: vi.fn(),
  read: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: m.user,
  isPlatformAdmin: m.admin,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: () => ({
      upsert: m.upsert,
      select: () => ({ eq: () => ({ maybeSingle: m.read }) }),
    }),
  }),
}));
import { saveAppSettings } from "./actions";
import { defaultAppSettings, getAppSettings } from "./settings";
import { allQuestionKeys } from "@/lib/onboarding/model";
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "admin-id" });
  m.admin.mockResolvedValue(true);
  m.upsert.mockResolvedValue({ error: null });
});
it("rejects anonymous and non-admin writes", async () => {
  m.user.mockResolvedValue(null);
  expect((await saveAppSettings(new FormData())).error).toBeTruthy();
  m.user.mockResolvedValue({ id: "member" });
  m.admin.mockResolvedValue(false);
  expect((await saveAppSettings(new FormData())).error).toBeTruthy();
  expect(m.upsert).not.toHaveBeenCalled();
});
it("persists disabled switches, selected steps, announcement, and verified actor", async () => {
  const f = new FormData();
  f.set("announcement", " Njoftim ");
  f.set("checklist_enabled", "on");
  f.append("onboarding_steps", "businessType");
  f.append("onboarding_steps", "productType");
  f.append("onboarding_steps", "forged");
  f.set("updated_by", "forged");
  expect((await saveAppSettings(f)).success).toBeTruthy();
  expect(m.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      id: true,
      onboarding_enabled: false,
      checklist_enabled: true,
      onboarding_steps: ["businessType", "productType"],
      announcement: "Njoftim",
      updated_by: "admin-id",
    }),
  );
  expect(m.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("rejects oversized announcements and reports database failures", async () => {
  const f = new FormData();
  f.set("announcement", "x".repeat(501));
  expect((await saveAppSettings(f)).error).toBeTruthy();
  expect(m.upsert).not.toHaveBeenCalled();
  m.upsert.mockResolvedValue({ error: { code: "42P01" } });
  expect((await saveAppSettings(new FormData())).error).toContain("migrimi");
});
it("loads persisted values and defaults only for a missing migration", async () => {
  const data = {
    onboarding_enabled: false,
    checklist_enabled: false,
    announcement: "Test",
    onboarding_steps: ["businessType", "aiMode"],
  };
  m.read.mockResolvedValue({ data, error: null });
  expect(await getAppSettings()).toEqual({...data, onboarding_mode: "guided"});
  m.read.mockResolvedValue({ data: null, error: { code: "42P01" } });
  expect(await getAppSettings()).toEqual(defaultAppSettings);
  m.read.mockResolvedValue({
    data: {
      onboarding_enabled: true,
      checklist_enabled: true,
      announcement: "",
    },
    error: null,
  });
  expect(await getAppSettings()).toEqual({
    ...defaultAppSettings,
    onboarding_steps: [...allQuestionKeys],
  });
  m.read.mockResolvedValue({ data: null, error: { code: "OTHER" } });
  await expect(getAppSettings()).rejects.toThrow();
});
it('persists and loads the administrator-selected agent mode', async () => {
  const form = new FormData(); form.set('onboarding_mode','agent');
  await saveAppSettings(form);
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({onboarding_mode:'agent'}));
  m.read.mockResolvedValue({data:{onboarding_mode:'agent'},error:null});
  expect((await getAppSettings()).onboarding_mode).toBe('agent');
});
