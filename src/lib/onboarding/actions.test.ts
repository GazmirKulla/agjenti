import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  user: vi.fn(),
  memberships: vi.fn(),
  rpc: vi.fn(),
}));
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
  it("rejects unauthenticated requests without a database write", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await saveOnboarding(answers, 7, true)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps admins in admin and invited members in their workspace", async () => {
    mocks.memberships.mockResolvedValue({ admin: true, businesses: [] });
    expect(await saveOnboarding(answers, 7, true)).toEqual({
      destination: "/admin",
    });
    mocks.memberships.mockResolvedValue({
      admin: false,
      businesses: [{ slug: "existing" }],
    });
    expect(await saveOnboarding(answers, 7, true)).toEqual({
      destination: "/b/existing",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("cannot spoof the owner identity", async () => {
    mocks.rpc.mockResolvedValue({ data: "biznes-123", error: null });
    expect(
      await saveOnboarding({ ...answers, p_user_id: "victim" }, 7, true),
    ).toEqual({ destination: "/b/biznes-123?welcome=1" });
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
        agentCapabilities: ["understand_needs", "recommend_products"],
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

it("creates a basic workspace without fabricated questionnaire answers when onboarding is off", async () => {
  mocks.settings.mockResolvedValue({ onboarding_enabled: false });
  mocks.rpc.mockResolvedValue({ data: "biznes-basic", error: null });
  const { emptyAnswers } = await import("./model");
  expect(
    await saveOnboarding({ ...emptyAnswers, name: "Biznesi" }, 7, true),
  ).toEqual({ destination: "/b/biznes-basic?welcome=1" });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "complete_business_onboarding",
    expect.objectContaining({
      p_answers: { ...emptyAnswers, name: "Biznesi" },
      p_instructions: expect.stringContaining("Mos shpik"),
    }),
  );
  expect((await saveOnboarding(emptyAnswers, 7, true)).error).toBeTruthy();
});
