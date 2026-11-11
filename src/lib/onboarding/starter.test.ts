import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  memberships: vi.fn(),
  rpc: vi.fn(),
  profile: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  listMemberships: mocks.memberships,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));
vi.mock("@/lib/dashboard/profile/service", () => ({
  persistGeneratedProfile: mocks.profile,
}));
import {
  createStarterWorkspace,
  parseStarterWorkspace,
  publicBusinessCategories,
} from "./starter";
import { businessCategories } from "./categories";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.memberships.mockResolvedValue({ admin: false, businesses: [] });
  mocks.rpc.mockResolvedValue({ data: "studio-lule", error: null });
  mocks.maybeSingle.mockResolvedValue({ data: { id: "biz-1" } });
  mocks.profile.mockResolvedValue({});
});

it("accepts a public business type and a name", () => {
  expect(
    parseStarterWorkspace({
      name: "  Studio Lule  ",
      businessType: "retail",
      p_user_id: "victim",
    }),
  ).toEqual({
    name: "Studio Lule",
    businessType: "retail",
    categoryDescription: "",
    instagramUsername: null,
    website: null,
  });
});

it("accepts an optional website with or without https", () => {
  const parse = (website: string) => parseStarterWorkspace({ name: "Studio", businessType: "retail", website });
  expect(parse("studio-lule.al")).toMatchObject({ website: "https://studio-lule.al/" });
  expect(parse("http://www.studio-lule.al/rreth#top")).toMatchObject({ website: "http://www.studio-lule.al/rreth" });
  expect(parse("")).toMatchObject({ website: null });
  expect(parse("jo website")).toHaveProperty("error");
  expect(parse("ftp://studio.al")).toHaveProperty("error");
});

it("accepts an optional Instagram username in any common form", () => {
  const parse = (instagramUsername: string) => parseStarterWorkspace({ name: "Studio", businessType: "retail", instagramUsername });
  expect(parse("@Studio.Lule")).toMatchObject({ instagramUsername: "studio.lule" });
  expect(parse("https://www.instagram.com/studio.lule/?igsh=abc")).toMatchObject({ instagramUsername: "studio.lule" });
  expect(parse("")).toMatchObject({ instagramUsername: null });
  expect(parse("not a username!")).toHaveProperty("error");
});

it("rejects legacy types, missing names and other without a description", () => {
  expect(parseStarterWorkspace({ name: "A", businessType: "retail" })).toMatchObject({
    error: expect.any(String),
  });
  expect(
    parseStarterWorkspace({ name: "Studio", businessType: "fashion" }),
  ).toMatchObject({ error: expect.any(String) });
  expect(
    parseStarterWorkspace({ name: "Studio", businessType: "other" }),
  ).toMatchObject({ error: expect.any(String) });
  expect(
    parseStarterWorkspace({
      name: "Studio",
      businessType: "other",
      categoryDescription: "Studio fotografike",
    }),
  ).toMatchObject({ businessType: "other", categoryDescription: "Studio fotografike" });
});

it("creates a business from the name alone; the type is asked afterwards", () => {
  expect(parseStarterWorkspace({ name: "Studio Lule", instagramUsername: "@studio.lule", website: "studiolule.al" }))
    .toMatchObject({ name: "Studio Lule", businessType: "", instagramUsername: "studio.lule", website: "https://studiolule.al/" });
});

it("creates a workspace with the selected type for the verified owner", async () => {
  expect(
    await createStarterWorkspace("verified-user", {
      name: "Studio Lule",
      businessType: "beauty",
      user_id: "victim",
    }),
  ).toEqual({ ok: true, slug: expect.any(String), instagramUsername: null, website: null });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "complete_business_onboarding",
    expect.objectContaining({
      p_user_id: "verified-user",
      p_answers: expect.objectContaining({
        name: "Studio Lule",
        businessType: "beauty",
      }),
      p_instructions: expect.stringContaining("Mos shpik"),
    }),
  );
  expect(mocks.profile).toHaveBeenCalledWith(
    "biz-1",
    expect.objectContaining({
      businessType: "beauty",
      useCases: ["messages", "support"],
      agentCapabilities: ["reply_messages", "answer_questions", "handoff"],
    }),
  );
});

it("does not create a workspace for platform admins, but does for people who already have one", async () => {
  mocks.memberships.mockResolvedValue({ admin: true, businesses: [] });
  expect(await createStarterWorkspace("admin", { name: "Studio", businessType: "retail" })).toMatchObject({ status: 409 });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.memberships.mockResolvedValue({
    admin: false,
    businesses: [{ slug: "existing" }],
  });
  await createStarterWorkspace("member", { name: "Studio", businessType: "retail" });
  expect(mocks.rpc).toHaveBeenCalledWith("complete_business_onboarding", expect.objectContaining({ p_user_id: "member" }));
});

it("returns a recoverable error when the workspace write fails", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
  expect(
    await createStarterWorkspace("verified-user", {
      name: "Studio",
      businessType: "retail",
    }),
  ).toMatchObject({ status: 503 });
  expect(mocks.profile).not.toHaveBeenCalled();
});

it("exposes only public categories for the mobile form", () => {
  const labels = publicBusinessCategories((label) => label);
  expect(labels.map((item) => item.id)).toEqual(
    businessCategories.map(([id]) => id),
  );
  expect(labels.map((item) => item.id)).not.toContain("fashion");
});
