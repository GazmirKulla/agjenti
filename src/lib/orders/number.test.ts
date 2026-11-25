import { beforeEach, expect, it, vi } from "vitest";
import { readOrderNumber } from "./number";
const m = vi.hoisted(() => ({ maybeSingle: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: (key: string, value: string) => { m.eq(key, value); return q; }, maybeSingle: m.maybeSingle };
  return q;
} }) }));
beforeEach(() => vi.resetAllMocks());
it("reads a persisted number scoped to both business and order", async () => {
  m.maybeSingle.mockResolvedValue({ data: { order_number: 1024 }, error: null });
  expect(await readOrderNumber("business", "order")).toBe(1024);
  expect(m.eq.mock.calls).toEqual([["business_id", "business"], ["id", "order"]]);
});
it("does not invent a number or fail an already saved order when the label cannot be read", async () => {
  for (const data of [null, { order_number: null }, { order_number: 0 }, { order_number: "1001" }]) {
    m.maybeSingle.mockResolvedValue({ data, error: null });
    expect(await readOrderNumber("business", "order")).toBeNull();
  }
  m.maybeSingle.mockRejectedValue(new Error("offline"));
  expect(await readOrderNumber("business", "order")).toBeNull();
});
