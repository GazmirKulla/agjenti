import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  fields: vi.fn(),
  stock: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/request", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/request")>(),
  getRequestUser: m.user,
}));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess: m.access }));
vi.mock("@/lib/items/fields-store", () => ({ storeProductFields: m.fields }));
vi.mock("@/lib/products/stock-store", () => ({ storeStockSettings: m.stock }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/ai/usage", () => ({ withAiUsage: vi.fn() }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: vi.fn() }));
vi.mock("@/lib/items/business", () => ({ loadItemSetup: vi.fn() }));
vi.mock("@/lib/onboarding/product-skeleton", () => ({ proposeProductSkeleton: vi.fn() }));

import { POST } from "./route";

const url = "https://agjenti.app/api/onboarding/product-structure?slug=zana";
const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer token.abc" }) =>
  POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const fields = [{ key: "ngjyra", label: "Ngjyra", type: "select", options: ["E bardhë"], variant: true }];
const stock = { deduct: "confirmed", display: "availability", defaultMode: "unique", lowThreshold: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "u1" });
  m.access.mockResolvedValue({ business: { id: "b1", slug: "zana" } });
  m.fields.mockResolvedValue({ fields });
  m.stock.mockResolvedValue({ settings: stock });
});

it("saves the confirmed fields and stock rules through the shared stores, for the signed-in member's business", async () => {
  const response = await post({ fields, stock });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, fields, stock });
  expect(m.access).toHaveBeenCalledWith("u1", "zana");
  expect(m.fields).toHaveBeenCalledWith("b1", "u1", fields);
  expect(m.stock).toHaveBeenCalledWith("b1", "u1", stock);
});

it("refuses cross-site writes, a missing sign-in and another business", async () => {
  expect((await post({ fields }, { authorization: "Bearer token.abc", "sec-fetch-site": "cross-site" })).status).toBe(403);
  m.user.mockResolvedValueOnce(null);
  expect((await post({ fields })).status).toBe(401);
  m.access.mockResolvedValueOnce(null);
  expect((await post({ fields })).status).toBe(403);
  expect(m.fields).not.toHaveBeenCalled();
});

it("does not save the stock rules when the fields are refused (e.g. not the owner)", async () => {
  m.fields.mockResolvedValueOnce({ error: "Vetëm pronari mund t’i ndryshojë fushat e produkteve." });
  const response = await post({ fields, stock });
  expect(response.status).toBe(400);
  expect(m.stock).not.toHaveBeenCalled();
  expect(m.revalidate).not.toHaveBeenCalled();
});

it("an empty request saves nothing", async () => {
  expect((await post({})).status).toBe(400);
  expect(m.fields).not.toHaveBeenCalled();
  expect(m.stock).not.toHaveBeenCalled();
});
