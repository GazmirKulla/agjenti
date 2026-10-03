import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from }),
}));

import { deleteBusinessCompletely } from "./delete-business";

function chain(result: unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  // Awaitable for delete().eq() without maybeSingle
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return query;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("deleteBusinessCompletely", () => {
  it("clears onboarding then hard-deletes the business", async () => {
    const load = chain({
      data: { id: "biz-a", slug: "lule", name: "Lule" },
      error: null,
    });
    const onboarding = chain({ error: null });
    const deleted = chain({
      data: { id: "biz-a", slug: "lule", name: "Lule" },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(load)
      .mockReturnValueOnce(onboarding)
      .mockReturnValueOnce(deleted);

    const result = await deleteBusinessCompletely("biz-a");
    expect(result).toEqual({ ok: true, slug: "lule", name: "Lule" });
    expect(mocks.from).toHaveBeenNthCalledWith(1, "businesses");
    expect(mocks.from).toHaveBeenNthCalledWith(2, "business_onboarding");
    expect(mocks.from).toHaveBeenNthCalledWith(3, "businesses");
    expect(onboarding.delete).toHaveBeenCalled();
    expect(deleted.delete).toHaveBeenCalled();
  });

  it("returns 404 when the business is missing", async () => {
    mocks.from.mockReturnValueOnce(chain({ data: null, error: null }));
    const result = await deleteBusinessCompletely("missing");
    expect(result).toEqual({
      ok: false,
      error: "Biznesi nuk u gjet.",
      status: 404,
    });
  });

  it("fails when onboarding cleanup fails", async () => {
    mocks.from
      .mockReturnValueOnce(
        chain({
          data: { id: "biz-a", slug: "lule", name: "Lule" },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ error: { message: "fail" } }));
    const result = await deleteBusinessCompletely("biz-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });
});
