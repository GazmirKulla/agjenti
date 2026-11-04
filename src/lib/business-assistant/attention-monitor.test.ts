import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), read: vi.fn(), member: true }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("./attention", () => ({ readAttentionEvidence: m.read }));
import { monitorBusinessAttention } from "./attention-monitor";
beforeEach(() => {
  vi.clearAllMocks(); m.member = true;
  m.read.mockResolvedValue({ items: [{ id: "booking:sync" }], unavailable: [] });
  m.rpc.mockResolvedValue({ data: 1, error: null });
  m.from.mockImplementation((table: string) => {
    let writing = false;
    const result = () => ({ data: table === "business_users" ? m.member ? { user_id: "owner" } : null : writing ? null : [{ business_id: "business", user_id: "owner", businesses: { slug: "shop" } }], error: null });
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, update: () => { writing = true; return q; }, maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }; return q;
  });
});
it("records only complete evidence and does not treat a failed source as resolved", async () => {
  m.read.mockResolvedValue({ items: [], unavailable: ["Bookings"] });
  expect(await monitorBusinessAttention()).toMatchObject({ checked: 0, unavailable: 1 });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not inspect a former member's private work", async () => {
  m.member = false; await monitorBusinessAttention();
  expect(m.read).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it("records evidence through the membership-checked deduplication function", async () => {
  expect(await monitorBusinessAttention()).toMatchObject({ checked: 1, created: 1 });
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("record_attention_check", { p_business: "business", p_user: "owner", p_items: [{ id: "booking:sync" }] });
});
