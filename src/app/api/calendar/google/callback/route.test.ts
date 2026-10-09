import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  profile: vi.fn(),
  exchange: vi.fn(),
  connection: vi.fn(),
  write: vi.fn(),
  payload: {
    userId: "user",
    businessId: "business",
    slug: "demo",
    state: "nonce",
    exp: 0,
  },
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  requireBusinessAccess: mocks.access,
}));
vi.mock("@/lib/dashboard/profile/service", () => ({
  loadDashboardProfile: mocks.profile,
}));
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: () => JSON.stringify(mocks.payload),
  encryptSecret: (s: string) => `encrypted:${s}`,
}));
vi.mock("@/lib/calendar/google", () => ({
  exchangeGoogleCode: mocks.exchange,
  googleConnection: mocks.connection,
  writableCalendars: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: () => ({
      upsert: (v: unknown) => {
        mocks.write(v);
        return { throwOnError: async () => ({}) };
      },
    }),
  }),
}));
import { GET } from "./route";
const request = (state = "nonce") =>
  new NextRequest(
    `http://localhost/api/calendar/google/callback?state=${state}&code=code`,
    { headers: { cookie: "agjenti_calendar_oauth=opaque" } },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.payload = {
    userId: "user",
    businessId: "business",
    slug: "demo",
    state: "nonce",
    exp: Date.now() + 60000,
  };
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.access.mockResolvedValue({
    business: { id: "business", slug: "demo" },
  });
  mocks.profile.mockResolvedValue({ enabledModules: ["calendar"] });
  mocks.connection.mockResolvedValue(null);
  mocks.exchange.mockResolvedValue({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
  });
});
it("rejects a state from another login session", async () => {
  mocks.payload.userId = "another-user";
  await GET(request());
  expect(mocks.exchange).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("rejects expired or mismatched OAuth state", async () => {
  mocks.payload.exp = Date.now() - 1;
  await GET(request());
  expect(mocks.exchange).not.toHaveBeenCalled();
  mocks.payload.exp = Date.now() + 60000;
  await GET(request("wrong-state"));
  expect(mocks.exchange).not.toHaveBeenCalled();
});
it("rechecks tenant membership before exchanging a Google code", async () => {
  mocks.access.mockResolvedValue({
    business: { id: "another-business", slug: "foreign" },
  });
  await GET(request());
  expect(mocks.exchange).not.toHaveBeenCalled();
});
it("does not connect Google to a disabled calendar module", async () => {
  mocks.profile.mockResolvedValue({ enabledModules: [] });
  await GET(request());
  expect(mocks.exchange).not.toHaveBeenCalled();
});
it("stores encrypted tokens only for the authorized business and expires the nonce cookie", async () => {
  const response = await GET(request());
  expect(mocks.write).toHaveBeenCalledWith(
    expect.objectContaining({
      business_id: "business",
      access_token_encrypted: "encrypted:access-token",
      refresh_token_encrypted: "encrypted:refresh-token",
    }),
  );
  expect(response.headers.get("location")).toContain(
    "/b/demo/calendar?google=connected",
  );
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});
