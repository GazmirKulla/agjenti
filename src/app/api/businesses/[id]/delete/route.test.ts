import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  deleteBusiness: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: mocks.admin }));
vi.mock("@/lib/businesses/delete-business", () => ({
  deleteBusinessCompletely: mocks.deleteBusiness,
}));

import { POST } from "./route";

function request(body: unknown) {
  return POST(
    new Request("https://example.test/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "biz-a" }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
  mocks.admin.mockResolvedValue(true);
  mocks.maybeSingle.mockResolvedValue({
    data: { slug: "lule" },
    error: null,
  });
  mocks.deleteBusiness.mockResolvedValue({
    ok: true,
    slug: "lule",
    name: "Lule",
  });
});

describe("DELETE business API", () => {
  it("rejects unauthenticated users", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await request({ confirmSlug: "lule" })).status).toBe(403);
    expect(mocks.deleteBusiness).not.toHaveBeenCalled();
  });

  it("rejects members without access", async () => {
    mocks.admin.mockResolvedValue(false);
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await request({ confirmSlug: "lule" })).status).toBe(403);
    expect(mocks.deleteBusiness).not.toHaveBeenCalled();
  });

  it("requires the exact business slug", async () => {
    const response = await request({ confirmSlug: "wrong" });
    expect(response.status).toBe(400);
    expect(mocks.deleteBusiness).not.toHaveBeenCalled();
  });

  it("deletes when slug confirmation matches", async () => {
    const response = await request({ confirmSlug: "lule" });
    expect(response.status).toBe(200);
    expect(mocks.deleteBusiness).toHaveBeenCalledWith("biz-a");
  });
});
