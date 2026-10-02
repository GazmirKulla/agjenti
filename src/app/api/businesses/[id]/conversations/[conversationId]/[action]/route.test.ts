import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: mocks.admin }));
import { POST } from "./route";
const request = (action = "pause") =>
  POST(new Request("https://example.test/api/action", { method: "POST" }), {
    params: Promise.resolve({
      id: "business-a",
      conversationId: "conversation-a",
      action,
    }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    update: mocks.update,
    eq: mocks.eq,
    select: mocks.select,
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
  mocks.admin.mockResolvedValue(true);
  mocks.maybeSingle.mockResolvedValue({
    data: { id: "conversation-a" },
    error: null,
  });
});
describe("conversation status actions", () => {
  it("does not claim success when the database rejects the update", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty("error");
  });
  it("treats missing or other-tenant conversations as not found", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.eq).toHaveBeenCalledWith("id", "conversation-a");
    expect(mocks.eq).toHaveBeenCalledWith("business_id", "business-a");
  });
  it("rejects users without business access before updating", async () => {
    mocks.admin.mockResolvedValue(false);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await request()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await request()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["pause", "resume", "complete"])(
    "persists %s only within the requested business",
    async (action) => {
      expect((await request(action)).status).toBe(200);
      expect(mocks.eq).toHaveBeenCalledWith("business_id", "business-a");
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ auto_reply: action === "resume" }),
      );
    },
  );
  it.each(["unknown", "__proto__"])(
    "rejects the invalid action %s without writing",
    async (action) => {
      expect((await request(action)).status).toBe(404);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
});
