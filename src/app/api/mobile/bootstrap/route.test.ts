import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  memberships: vi.fn(),
  profile: vi.fn(),
  aiUsage: vi.fn(),
  billing: vi.fn(),
}));
vi.mock("@/lib/ai/usage-report", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAiUsage: mocks.aiUsage,
}));
vi.mock("@/lib/auth/request", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/tenant/access", () => ({ listMemberships: mocks.memberships }));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadNavigationProfile: mocks.profile,
}));
vi.mock("@/lib/billing/service", async (importOriginal) => ({
  ...(await importOriginal()),
  loadBillingUsage: mocks.billing,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "owner", email: "owner@example.test" });
  mocks.memberships.mockResolvedValue({
    businesses: [{ id: "b1", slug: "one", name: "One" }],
  });
  mocks.profile.mockResolvedValue({ enabledModules: ["products", "settings"], navigationItems: ["products", "settings"] });
  mocks.aiUsage.mockResolvedValue(null);
  mocks.billing.mockResolvedValue({ available: 980, plan: "free" });
});
it("requires a verified user before enumerating businesses", async () => {
  mocks.user.mockResolvedValue(null);
  expect(
    (await GET(new Request("https://app.test/api/mobile/bootstrap"))).status,
  ).toBe(401);
  expect(mocks.memberships).not.toHaveBeenCalled();
});
it("returns only allowed businesses and modules without exposing credentials", async () => {
  const response = await GET(
    new Request("https://app.test/api/mobile/bootstrap?userId=attacker"),
  );
  const data = await response.json();
  expect(mocks.memberships).toHaveBeenCalledWith("owner");
  expect(data.businesses).toHaveLength(1);
  expect(
    data.businesses[0].navigation.map((x: { id: string }) => x.id),
  ).toEqual(["campaigns", "products", "settings"]);
  expect(data.user).toEqual({ id: "owner", email: "owner@example.test", canDeleteAccount: true });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(data.businesses[0].aiUsage).toBeNull();
  expect(data.businesses[0].messagesAvailable).toBe(980);
  expect(data.businesses[0].planName).toBe("Free");
  expect(data.businessCategories).toEqual(
    expect.arrayContaining([
      { id: "retail", label: "Dyqan / Tregti" },
      { id: "other", label: "Tjetër" },
    ]),
  );
  expect(data.businessCategories.map((item: { id: string }) => item.id)).not.toContain("fashion");
});
it("sends the agent as its own group by topic: business, offer, communication, test and advanced processes, with sources inside the offer", async () => {
  mocks.profile.mockResolvedValueOnce({ enabledModules: [], navigationItems: ["workflows", "sources", "agents", "knowledge", "products", "services"] });
  const data = await (await GET(new Request("https://app.test/api/mobile/bootstrap"))).json();
  const navigation = data.businesses[0].navigation as { id: string; group?: string; path: string; label: string }[];
  expect(navigation.filter((item) => item.group === "agent").map((item) => [item.id, item.label])).toEqual([
    ["agent-business", "Biznesi"], ["knowledge", "Oferta"], ["agent-bookings", "Kur klienti rezervon"], ["agents", "Si flet dhe kur thërret stafin"], ["agent-test", "Prova dhe kontrolli"], ["workflows", "Proceset e avancuara"]]);
  expect(navigation.find((item) => item.id === "agent-test")?.path).toMatch(/\/agents\/test$/);
  expect(navigation.some((item) => item.id === "sources")).toBe(false);
  expect(navigation.find((item) => item.id === "products")?.group).toBeUndefined();
});
it("translates public business categories for the requested language", async () => {
  const data = await (
    await GET(
      new Request("https://app.test/api/mobile/bootstrap", {
        headers: { "X-Agjenti-Language": "en" },
      }),
    )
  ).json();
  expect(data.businessCategories).toEqual(
    expect.arrayContaining([
      { id: "retail", label: "Shop / Retail" },
      { id: "other", label: "Other" },
    ]),
  );
});
it("omits remaining messages when the allowance cannot be read", async () => {
  mocks.billing.mockRejectedValue(Error("billing"));
  const data = await (await GET(new Request("https://app.test/api/mobile/bootstrap"))).json();
  expect(data.businesses[0].messagesAvailable).toBeUndefined();
});
it("never sends AI token usage to business users: tokens are a platform statistic", async () => {
  mocks.aiUsage.mockResolvedValue({ calls: 7, inputTokens: 100, outputTokens: 20 });
  const data = await (await GET(new Request("https://app.test/api/mobile/bootstrap"))).json();
  expect(mocks.aiUsage).not.toHaveBeenCalled();
  expect(data.businesses[0].aiUsage).toBeNull();
});
it("reports backend failures instead of fabricating an empty workspace", async () => {
  mocks.profile.mockRejectedValue(Error("db"));
  expect(
    (await GET(new Request("https://app.test/api/mobile/bootstrap"))).status,
  ).toBe(503);
});
it("passes each business's logo to the app, and null when it has none", async () => {
  mocks.memberships.mockResolvedValue({
    businesses: [{ id: "b1", slug: "one", name: "One", logo_url: "https://x.supabase.co/storage/v1/object/public/business-logos/b1/instagram-1.jpg" }, { id: "b2", slug: "two", name: "Two", logo_url: null }],
  });
  const data = await (await GET(new Request("https://app.test/api/mobile/bootstrap"))).json();
  expect(data.businesses.map((b: { logo_url: string | null }) => b.logo_url)).toEqual(["https://x.supabase.co/storage/v1/object/public/business-logos/b1/instagram-1.jpg", null]);
});
