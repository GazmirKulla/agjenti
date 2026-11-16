import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), row: null as unknown, logs: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: m.row, error: null }),
    insert: async (row: unknown) => { m.logs.push(row); return { error: null }; } };
  return q;
} }) }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "business-secret", encryptSecret: (v: string) => `cipher:${v}` }));
import { amendExternalOrder, fetchExternalOrder } from "./zana";

const changeId = "30000000-0000-4000-8000-000000000001";
const changes = { customer: { address: "Rr. Panajot Pano" } };
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => {
  vi.clearAllMocks();
  m.logs = [];
  m.row = { orders_url: "https://shop.test/api/integrations/agjenti/orders", secret_ciphertext: "cipher:x", kind: "http" };
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("sends PATCH {orders_url}/{id} with the change id and only the changes", async () => {
  m.fetch.mockResolvedValue(answer(200, { ok: true, status: "pending", items: [] }));
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "accepted", view: { status: "pending", items: [] } });
  const [url, init] = m.fetch.mock.calls[0];
  expect(url).toBe("https://shop.test/api/integrations/agjenti/orders/ord_1");
  expect(init.method).toBe("PATCH");
  expect(init.headers["X-Agjenti-Change-Id"]).toBe(changeId);
  expect(init.headers.Authorization).toBe("Bearer business-secret");
  expect(JSON.parse(init.body)).toEqual({ version: 2, changes });
});

it("a refusal keeps the website's code; nothing changed", async () => {
  m.fetch.mockResolvedValue(answer(409, { ok: false, error: "not_editable" }));
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "rejected", code: "not_editable" });
  m.fetch.mockResolvedValue(answer(400, { ok: false, error: "invalid", field: "customer.phone" }));
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "rejected", code: "invalid", field: "customer.phone" });
});

it("a website without the route refuses (404/405)", async () => {
  m.fetch.mockResolvedValue(answer(404, null));
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "rejected", code: "change_unsupported" });
  m.fetch.mockResolvedValue(answer(405, null));
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "rejected", code: "change_unsupported" });
});

it.each([
  ["a timeout", () => m.fetch.mockRejectedValue(new Error("timeout"))],
  ["a server error", () => m.fetch.mockResolvedValue(answer(500, { ok: false, error: "db" }))],
  ["a 2xx without ok", () => m.fetch.mockResolvedValue(answer(200, { saved: true }))],
  ["too many requests", () => m.fetch.mockResolvedValue(answer(429, { ok: false, error: "slow_down" }))],
])("%s is uncertain, never a refusal", async (_, setup) => {
  setup();
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "uncertain" });
});

it("refuses without a safe https orders URL or a safe order id, without calling the website", async () => {
  m.row = { orders_url: "http://shop.test/orders", secret_ciphertext: null, kind: "http" };
  expect(await amendExternalOrder("b", "ord_1", changeId, changes)).toEqual({ status: "rejected", code: "integration_unavailable" });
  m.row = { orders_url: "https://shop.test/orders", secret_ciphertext: null, kind: "http" };
  expect(await amendExternalOrder("b", "../x", changeId, changes)).toEqual({ status: "rejected", code: "integration_unavailable" });
  expect(m.fetch).not.toHaveBeenCalled();
});

it("reads whether the website still allows a change", async () => {
  m.fetch.mockResolvedValue(answer(200, { ok: true, status: "in_production", editable: false, items: [] }));
  expect(await fetchExternalOrder("b", "ord_1")).toMatchObject({ status: "in_production", editable: false });
  m.fetch.mockResolvedValue(answer(200, { ok: true, status: "pending", editable: "yes", items: [] }));
  expect(await fetchExternalOrder("b", "ord_1")).not.toHaveProperty("editable");
});
