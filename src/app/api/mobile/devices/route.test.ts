import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  permitted: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/lib/auth/request", () => ({
  getRequestUser: mocks.user,
  permittedWrite: mocks.permitted,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
import { POST } from "./route";
const req = (body: unknown) =>
  new Request("https://app.test/api/mobile/devices", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.permitted.mockReturnValue(true);
  const chain = {
    eq: mocks.eq,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  mocks.eq.mockReturnValue(chain);
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ delete: () => chain, upsert: mocks.upsert });
});
it("does not allow cookie requests without CSRF checks", async () => {
  mocks.permitted.mockReturnValue(false);
  expect((await POST(req({}))).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("rejects unauthenticated registrations", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await POST(req({}))).status).toBe(401);
});
it("binds registration to server verified identity", async () => {
  const response = await POST(
    req({
      mode: "register",
      token: "ExpoPushToken[valid_token]",
      platform: "ios",
      user_id: "victim",
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: "owner" }),
  );
});
it("removes only the current user device", async () => {
  expect(
    (await POST(req({ mode: "remove", token: "ExpoPushToken[valid_token]" })))
      .status,
  ).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith("user_id", "owner");
});
it("rejects malformed tokens and unsupported platforms before writes", async () => {
  expect(
    (
      await POST(
        req({ mode: "register", token: "javascript:bad", platform: "ios" }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});
