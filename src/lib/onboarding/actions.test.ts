import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  user: vi.fn(),
  memberships: vi.fn(),
  rpc: vi.fn(),
  starter: vi.fn(),
}));
vi.mock("./starter", () => ({ createStarterWorkspace: mocks.starter }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  listMemberships: mocks.memberships,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/platform/settings", () => ({ getAppSettings: mocks.settings }));
import { saveOnboarding } from "./actions";
const answers = {
  name: "Dyqani",
  businessType: "fashion",
  useCases: ["sales"],
  productCount: "1-10",
  productType: "variants",
  aiMode: "sales",
  messageVolume: "100-500",
  teamSize: "solo",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ onboarding_enabled: true });
  mocks.user.mockResolvedValue({ id: "verified-user" });
  mocks.memberships.mockResolvedValue({ admin: false, businesses: [] });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
describe("self-service onboarding boundary", () => {
  it("creates an agent-mode workspace from the name and business type for the verified owner", async () => {
    mocks.starter.mockResolvedValue({ ok: true, slug: "biznes-agent" });
    const { createAgentWorkspace } = await import("./actions");
    const form = new FormData();
    form.set("name", "Studio");
    form.set("businessType", "beauty");
    form.set("user_id", "victim");
    expect(await createAgentWorkspace(form)).toEqual({ destination: "/onboarding/sources?slug=biznes-agent" });
    expect(mocks.starter).toHaveBeenCalledWith("verified-user", { name: "Studio", businessType: "beauty", categoryDescription: "" });
  });
  it("returns the starter validation error for a missing business type", async () => {
    mocks.starter.mockResolvedValue({ error: "Zgjidh llojin e biznesit.", status: 400 });
    const { createAgentWorkspace } = await import("./actions");
    const form = new FormData();
    form.set("name", "Studio");
    expect(await createAgentWorkspace(form)).toEqual({ error: "Zgjidh llojin e biznesit." });
  });
  it("rejects unauthenticated requests without a database write", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await saveOnboarding(answers, 7, true)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps admins in admin and lets people with a business create another one", async () => {
    mocks.memberships.mockResolvedValue({ admin: true, businesses: [] });
    expect(await saveOnboarding(answers, 7, true)).toEqual({
      destination: "/admin",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.memberships.mockResolvedValue({
      admin: false,
      businesses: [{ slug: "existing" }],
    });
    mocks.rpc.mockResolvedValue({ data: "biznes-second", error: null });
    expect(await saveOnboarding(answers, 7, true)).toEqual({
      destination: "/onboarding/sources?slug=biznes-second",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_business_onboarding", expect.objectContaining({ p_user_id: "verified-user" }));
  });
  it("cannot spoof the owner identity", async () => {
    mocks.rpc.mockResolvedValue({ data: "biznes-123", error: null });
    expect(
      await saveOnboarding({ ...answers, p_user_id: "victim" }, 7, true),
    ).toEqual({ destination: "/onboarding/sources?slug=biznes-123" });
    const completion = mocks.rpc.mock.calls.find(
      ([name]) => name === "complete_business_onboarding",
    );
    expect(completion?.[1]).toMatchObject({
      p_user_id: "verified-user",
      p_answers: expect.objectContaining({
        name: answers.name,
        businessType: answers.businessType,
        useCases: answers.useCases,
        selectedUseCases: answers.useCases,
        offeringTypes: ["variants"],
        productType: "variants",
        agentCapabilities: expect.arrayContaining(["understand_needs", "recommend_products"]),
        businessProfile: expect.any(Object),
      }),
    });
  });
  it("saves drafts independently of completing the workspace", async () => {
    expect(await saveOnboarding({ ...answers, teamSize: "" }, 6)).toEqual({
      saved: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_onboarding_draft",
      expect.objectContaining({ p_step: 6 }),
    );
  });
  it("rejects invalid steps and incomplete final submissions", async () => {
    expect((await saveOnboarding(answers, 9)).error).toBeTruthy();
    expect(
      (
        await saveOnboarding(
          { ...answers, teamSize: "", useCases: [] },
          7,
          true,
        )
      ).error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns recoverable errors for failed transactions and network failures", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect((await saveOnboarding(answers, 7, true)).error).toBeTruthy();
    mocks.rpc.mockRejectedValue(new Error("network"));
    expect((await saveOnboarding(answers, 3)).error).toBeTruthy();
  });
  it("does not follow an invalid destination from a failed RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: "//untrusted.test", error: null });
    expect(
      (await saveOnboarding(answers, 7, true)).destination,
    ).toBeUndefined();
  });
});

it("keeps the manual answers even when the Instagram analysis switch is off", async () => {
  mocks.settings.mockResolvedValue({ onboarding_enabled: false });
  mocks.rpc.mockResolvedValue({ data: "biznes-manual", error: null });
  const { emptyAnswers } = await import("./model");
  const result = await saveOnboarding(answers, 7, true);
  expect(result).toEqual({ destination: "/onboarding/sources?slug=biznes-manual" });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "complete_business_onboarding",
    expect.objectContaining({ p_answers: expect.objectContaining({ name: "Dyqani", businessType: "fashion" }) }),
  );
  expect((await saveOnboarding(emptyAnswers, 7, true)).error).toBeTruthy();
});
