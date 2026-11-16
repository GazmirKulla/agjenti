import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), amend: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/integrations/zana", () => ({ amendExternalOrder: m.amend, fetchExternalOrder: vi.fn() }));
import { amendOrder, readChangeValues } from "./amend";

const ids = { businessId: "10000000-0000-4000-8000-000000000001", userId: "u", orderId: "20000000-0000-4000-8000-000000000001", changeId: "30000000-0000-4000-8000-000000000001" };
const changes = { customer: { address: "Rr. Panajot Pano" } };
const row = (status: string, extra: Record<string, unknown> = {}) => ({ change_id: ids.changeId, status, external: true,
  before: { customer: { address: "Rr. e vjetër" }, note: null }, changes, error: null, created_at: "2026-11-16T10:00:00Z", ...extra });
beforeEach(() => vi.clearAllMocks());

it("an order only in Agjenti changes at once, without the website", async () => {
  m.rpc.mockResolvedValueOnce({ data: { ...row("accepted", { external: false }), send: false }, error: null });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: true, change: { status: "accepted", external: false } });
  expect(m.amend).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledOnce();
});

it("an order on the website changes only when the website accepts, with the same change id", async () => {
  m.rpc.mockResolvedValueOnce({ data: { ...row("pending"), send: true, externalOrderId: "ord_1" }, error: null })
    .mockResolvedValueOnce({ data: row("accepted"), error: null });
  m.amend.mockResolvedValue({ status: "accepted", view: null });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: true, change: { status: "accepted" } });
  expect(m.amend).toHaveBeenCalledWith(ids.businessId, "ord_1", ids.changeId, changes);
  expect(m.rpc).toHaveBeenLastCalledWith("finish_order_change", { p_business: ids.businessId, p_change: ids.changeId, p_status: "accepted", p_error: null });
});

it("a refusal is recorded with the website's code and explained", async () => {
  m.rpc.mockResolvedValueOnce({ data: { ...row("pending"), send: true, externalOrderId: "ord_1" }, error: null })
    .mockResolvedValueOnce({ data: row("rejected", { error: "not_editable" }), error: null });
  m.amend.mockResolvedValue({ status: "rejected", code: "not_editable" });
  const outcome = await amendOrder({ ...ids, changes });
  expect(outcome).toMatchObject({ ok: false, status: 409 });
  expect(!outcome.ok && outcome.error).toContain("nuk e lejon më");
  expect(m.rpc).toHaveBeenLastCalledWith("finish_order_change", expect.objectContaining({ p_status: "rejected", p_error: "not_editable" }));
});

it("an unclear answer is never success; it can be sent again", async () => {
  m.rpc.mockResolvedValueOnce({ data: { ...row("pending"), send: true, externalOrderId: "ord_1" }, error: null })
    .mockResolvedValueOnce({ data: row("uncertain"), error: null });
  m.amend.mockResolvedValue({ status: "uncertain" });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: false, status: 202, change: { status: "uncertain" } });
});

it("the same request after it settled is not sent again", async () => {
  m.rpc.mockResolvedValueOnce({ data: { ...row("accepted"), send: false }, error: null });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: true });
  expect(m.amend).not.toHaveBeenCalled();
});

it("database refusals become the owner's words, and an unrecorded answer is not success", async () => {
  m.rpc.mockResolvedValueOnce({ data: null, error: { message: "change_in_progress" } });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: false, status: 409 });
  m.rpc.mockResolvedValueOnce({ data: null, error: { message: "customer_required" } });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: false, status: 400 });
  m.rpc.mockResolvedValueOnce({ data: { ...row("pending"), send: true, externalOrderId: "ord_1" }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  m.amend.mockResolvedValue({ status: "accepted", view: null });
  expect(await amendOrder({ ...ids, changes })).toMatchObject({ ok: false, status: 503 });
  expect(await amendOrder({ ...ids, changeId: "x", changes })).toMatchObject({ ok: false, status: 400 });
});

it("reads only the delivery fields and the note", () => {
  expect(readChangeValues({ customer: { address: "A", city: null }, note: "" })).toEqual({ customer: { address: "A", city: null }, note: "" });
  expect(readChangeValues({ customer: { address: "A" }, status: "cancelled" })).toBeNull();
  expect(readChangeValues({ customer: { email: "x@y.z" } })).toBeNull();
  expect(readChangeValues({ customer: { phone: 69 } })).toBeNull();
  expect(readChangeValues({ customer: {} })).toBeNull();
  expect(readChangeValues(null)).toBeNull();
});
