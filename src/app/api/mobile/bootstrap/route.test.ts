import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  memberships: vi.fn(),
  profile: vi.fn(),
  aiUsage: vi.fn(),
}));
vi.mock("@/lib/ai/usage-report", () => ({ loadAiUsage: mocks.aiUsage }));
vi.mock("@/lib/auth/request", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/tenant/access", () => ({ listMemberships: mocks.memberships }));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadNavigationProfile: mocks.profile,
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
  ).toEqual(["products", "settings"]);
  expect(data.user).toEqual({ id: "owner", email: "owner@example.test", canDeleteAccount: true });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(data.businesses[0].aiUsage).toBeNull();
});
it("includes monthly AI usage only as authorised by the usage report", async () => {
  mocks.aiUsage.mockResolvedValue({ calls: 7, inputTokens: 100, outputTokens: 20 });
  const data = await (await GET(new Request("https://app.test/api/mobile/bootstrap"))).json();
  expect(mocks.aiUsage).toHaveBeenCalledWith("owner", "b1", undefined);
  expect(data.businesses[0].aiUsage).toEqual({ calls: 7 });
});
it("reports backend failures instead of fabricating an empty workspace", async () => {
  mocks.profile.mockRejectedValue(Error("db"));
  expect(
    (await GET(new Request("https://app.test/api/mobile/bootstrap"))).status,
  ).toBe(503);
});
