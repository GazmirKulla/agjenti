import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  user: vi.fn(),
  memberships: vi.fn(),
  access: vi.fn(),
  starter: vi.fn(),
  tables: {} as Record<string, unknown>,
  update: vi.fn(),
}));
vi.mock("./starter", () => ({ createStarterWorkspace: mocks.starter }));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  listMemberships: mocks.memberships,
  requireBusinessAccess: mocks.access,
}));
vi.mock("@/lib/platform/settings", () => ({ getAppSettings: mocks.settings }));
// Every read resolves to the table's canned result; updates are recorded.
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "not", "order", "limit"]) chain[name] = () => chain;
      chain.maybeSingle = async () => mocks.tables[table];
      chain.then = (ok: (value: unknown) => void) => ok(mocks.tables[table]);
      chain.update = (row: unknown) => { mocks.update(table, row); const done = { eq: () => done, then: (ok: (v: unknown) => void) => ok({ error: null }) }; return done; };
      return chain;
    },
  }),
}));
import { createBusiness, finishOnboardingProfile } from "./actions";
import { allQuestionKeys, basicInstructions, emptyAnswers } from "./model";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ onboarding_steps: [...allQuestionKeys] });
  mocks.user.mockResolvedValue({ id: "verified-user" });
  mocks.memberships.mockResolvedValue({ admin: false, businesses: [] });
  mocks.tables = {};
});

describe("onboarding step 1: the business and its sources", () => {
  it("creates the business for the verified owner and confirms the sources next", async () => {
    mocks.starter.mockResolvedValue({ ok: true, slug: "biznes-1", instagramUsername: "zana.store", website: null });
    const result = await createBusiness(form({ name: "Zana", instagramUsername: "@zana.store", website: "", user_id: "victim" }));
    expect(result).toEqual({ destination: "/onboarding/sources?slug=biznes-1&instagram=zana.store" });
    expect(mocks.starter).toHaveBeenCalledWith("verified-user", { name: "Zana", instagramUsername: "@zana.store", website: "" });
  });
  it("goes straight to the questions without sources", async () => {
    mocks.starter.mockResolvedValue({ ok: true, slug: "biznes-1", instagramUsername: null, website: null });
    expect(await createBusiness(form({ name: "Zana" }))).toEqual({ destination: "/onboarding/questions?slug=biznes-1" });
  });
  it("returns the validation error and creates nothing for anonymous people", async () => {
    mocks.starter.mockResolvedValue({ error: "Vendos emrin e biznesit (të paktën 2 karaktere).", status: 400 });
    expect(await createBusiness(form({ name: "Z" }))).toEqual({ error: "Vendos emrin e biznesit (të paktën 2 karaktere)." });
    mocks.user.mockResolvedValue(null);
    expect((await createBusiness(form({ name: "Zana" }))).error).toBeTruthy();
    expect(mocks.starter).toHaveBeenCalledTimes(1);
  });
  it("keeps platform administrators in the admin workspace", async () => {
    mocks.memberships.mockResolvedValue({ admin: true, businesses: [] });
    expect(await createBusiness(form({ name: "Zana" }))).toEqual({ destination: "/admin" });
    expect(mocks.starter).not.toHaveBeenCalled();
  });
});

describe("onboarding step 2: instructions from the answers", () => {
  const business = { id: "b1", slug: "biznes-1", name: "Zana" };
  const answers = { ...emptyAnswers, name: "Zana", businessType: "retail", useCases: ["orders"] };
  beforeEach(() => {
    mocks.access.mockResolvedValue({ business });
    mocks.tables = {
      business_onboarding: { data: { answers } },
      ai_agents: { data: { id: "a1", instructions: basicInstructions("Zana") } },
      business_discovery_jobs: { data: [] },
    };
  });
  it("replaces the untouched starter instructions", async () => {
    expect(await finishOnboardingProfile("biznes-1")).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith("ai_agents", expect.objectContaining({ instructions: expect.not.stringMatching(/^Je asistenti i biznesit Zana\. Përgjigju/) }));
  });
  it("leaves instructions the owner changed, and waits for a scan proposal", async () => {
    mocks.tables.ai_agents = { data: { id: "a1", instructions: "Udhëzimet e mia" } };
    await finishOnboardingProfile("biznes-1");
    mocks.tables.ai_agents = { data: { id: "a1", instructions: basicInstructions("Zana") } };
    mocks.tables.business_discovery_jobs = { data: [{ status: "running", checkpoint: {} }] };
    await finishOnboardingProfile("biznes-1");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does nothing for a business the person cannot open", async () => {
    mocks.access.mockResolvedValue(null);
    expect(await finishOnboardingProfile("tjeter")).toEqual({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
