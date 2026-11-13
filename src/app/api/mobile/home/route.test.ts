import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), profile: vi.fn(), home: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ getRequestUser: mocks.user }));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess: mocks.access }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: mocks.profile }));
vi.mock("@/lib/home/summary", () => ({ loadHomeModules: mocks.home }));
import { GET } from "./route";

const business = { id: "b1", slug: "one", name: "One" };
const profile = { source: "manual", enabledModules: ["products", "customers"], hiddenModules: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.access.mockResolvedValue({ business });
  mocks.profile.mockResolvedValue(profile);
  mocks.home.mockResolvedValue({
    period: "7", messages: { inbound: 4, agentReplies: 3, handoffs: 0, days: [] },
    cards: [{ id: "products", label: "Produktet", icon: "products", href: "/b/one/products", value: 0, caption: "produkte",
      empty: { text: "Agjenti u përgjigjet klientëve me produktet që shton këtu.", actions: [{ label: "Shto produkt", href: "/b/one/products/new" }] } }],
    others: [{ id: "bookings", label: "Rezervime", description: "Rezervimet dhe kërkesat", icon: "orders", href: "/b/one/bookings", requires: ["Shërbime"] }],
  });
});
const get = (query: string, headers?: HeadersInit) => GET(new Request(`https://app.test/api/mobile/home${query}`, { headers }));

it("requires a signed-in user", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await get("?slug=one")).status).toBe(401);
  expect(mocks.access).not.toHaveBeenCalled();
});

it("refuses a business the user does not belong to, without reading it", async () => {
  mocks.access.mockResolvedValue(null);
  const response = await get("?slug=other");
  expect(response.status).toBe(403);
  expect(mocks.access).toHaveBeenCalledWith("owner", "other");
  expect(mocks.home).not.toHaveBeenCalled();
});

it("rejects an unknown period", async () => {
  expect((await get("?slug=one&period=90")).status).toBe(400);
  expect(mocks.home).not.toHaveBeenCalled();
});

it("returns the same home data as the web page for the verified business", async () => {
  const response = await get("?slug=one&period=7&businessId=attacker");
  const data = await response.json();
  expect(mocks.home).toHaveBeenCalledWith(business, profile, "7", { userId: "owner" });
  expect(data.businessId).toBe("b1");
  expect(data.messages.inbound).toBe(4);
  expect(data.cards[0].empty.actions[0].href).toBe("/b/one/products/new");
  expect(data.others[0].requires).toEqual(["Shërbime"]);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("defaults to today", async () => {
  await get("?slug=one");
  expect(mocks.home).toHaveBeenCalledWith(business, profile, "today", { userId: "owner" });
});

it("shows a controlled failure when the figures cannot be read", async () => {
  mocks.home.mockRejectedValue(Error("db"));
  const response = await get("?slug=one");
  expect(response.status).toBe(503);
  expect((await response.json()).error).toBeTruthy();
});
