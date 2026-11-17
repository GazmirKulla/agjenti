import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ secret: "website-secret-123" as string | null, record: vi.fn(async () => true), logs: [] as unknown[] }));
vi.mock("@/lib/integrations/zana", () => ({ loadBusinessApiSecret: async () => m.secret, STATUS_KEY: /^[A-Za-z0-9_-]{1,40}$/ }));
vi.mock("@/lib/orders/external-status", async (original) => ({
  ...(await original<typeof import("@/lib/orders/external-status")>()),
  recordExternalStatus: m.record,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => ({ insert: async (row: unknown) => { m.logs.push(row); return {}; } }) }) }));

import { POST } from "./route";

const business = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, auth = "Bearer website-secret-123", id = business) =>
  POST(new Request("https://app.test/hook", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ businessId: id }) });

beforeEach(() => {
  m.secret = "website-secret-123";
  m.record.mockClear();
  m.logs = [];
});

it("keeps the status the business website sends for its order", async () => {
  const res = await call({ orderId: "ord_1", status: "shipped", statusLabel: "Postuar", changedAt: "2026-11-17T09:00:00Z" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, updated: true });
  expect(m.record).toHaveBeenCalledWith(expect.anything(), business, "ord_1", { status: "shipped", label: "Postuar", at: "2026-11-17T09:00:00.000Z" });
});

it("refuses a wrong or missing secret, a business without one, and an invalid payload", async () => {
  expect((await call({ orderId: "ord_1", status: "shipped" }, "Bearer wrong")).status).toBe(401);
  expect((await call({ orderId: "ord_1", status: "shipped" }, "")).status).toBe(401);
  m.secret = null;
  expect((await call({ orderId: "ord_1", status: "shipped" })).status).toBe(401);
  m.secret = "website-secret-123";
  expect((await call({ orderId: "ord 1", status: "shipped" })).status).toBe(400);
  expect((await call({ orderId: "ord_1", status: "" })).status).toBe(400);
  expect((await call({ orderId: "ord_1", status: "shipped" }, undefined, "not-a-business")).status).toBe(404);
  expect(m.record).not.toHaveBeenCalled();
});
