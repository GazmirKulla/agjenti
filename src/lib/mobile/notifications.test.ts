import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  access: vi.fn(),
  fetch: vi.fn(),
  record: vi.fn(),
  updates: [] as unknown[],
}));
vi.mock("@/lib/tracking/system-events", async original => ({ ...await original<typeof import("@/lib/tracking/system-events")>(), recordSystem: mocks.record }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess: mocks.access }));
import { deliverMobileNotifications } from "./notifications";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.rpc.mockResolvedValue({
    data: [
      {
        id: "delivery",
        event_id: "event",
        token: "ExpoPushToken[test]",
        attempts: 1,
        receipt_id: null,
      },
    ],
    error: null,
  });
  mocks.access.mockResolvedValue({ business: { id: "business" } });
  const rows: Record<string, unknown> = {
    mobile_notification_events: {
      id: "event",
      user_id: "owner",
      business_id: "business",
      conversation_id: "conversation",
      kind: "assistant",
    },
    mobile_devices: { user_id: "owner" },
    businesses: { slug: "one" },
    assistant_conversations: { id: "conversation" },
  };
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      lt: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => ({ data: rows[table] }),
      maybeSingle: async () => ({ data: rows[table] }),
      update: (value: unknown) => {
        mocks.updates.push(value);
        return chain;
      },
      delete: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: "ok", id: "receipt" }] }),
  });
});
it("never sends after business membership is revoked", async () => {
  mocks.access.mockResolvedValue(null);
  await deliverMobileNotifications();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.updates).toContainEqual({ status: "failed" });
});
it("sends references only, then waits for provider delivery receipts", async () => {
  await deliverMobileNotifications();
  const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
  expect(body[0].data).toEqual({
    eventId: "event",
    businessId: "business",
    conversationId: "conversation",
  });
  expect(mocks.updates).toContainEqual(
    expect.objectContaining({ status: "receipt", receipt_id: "receipt" }),
  );
});
it("keeps transient failures for retry without reporting delivery success", async () => {
  mocks.fetch.mockRejectedValue(Error("network"));
  await deliverMobileNotifications();
  expect(mocks.updates).toContainEqual(
    expect.objectContaining({ status: "pending" }),
  );
});
it("does not resend an accepted notification while checking its receipt", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        id: "delivery",
        event_id: "event",
        token: "ExpoPushToken[test]",
        attempts: 2,
        receipt_id: "receipt",
      },
    ],
    error: null,
  });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { receipt: { status: "ok" } } }),
  });
  await deliverMobileNotifications();
  expect(mocks.fetch.mock.calls[0][0]).toContain("getReceipts");
  expect(mocks.updates).toContainEqual(
    expect.objectContaining({ status: "sent" }),
  );
});

it("drops a notification older than six hours instead of sending it late", async () => {
  const from = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((table: string) => {
    const chain = from(table);
    if (table !== "mobile_notification_events") return chain;
    return { ...chain, select: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      eq: () => ({ single: async () => ({ data: { id: "event", user_id: "owner", business_id: "business", conversation_id: "conversation", kind: "assistant",
      created_at: new Date(Date.now() - 7 * 3600_000).toISOString() } }) }) }) };
  });
  await deliverMobileNotifications();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.updates).toContainEqual({ status: "failed" });
  expect(mocks.record).toHaveBeenCalledWith("system.mobile_push", "expired", expect.objectContaining({ businessId: "business" }));
});
it.each([
  [{ ok: false, status: 401, json: async () => ({ errors: [{ code: "UNAUTHORIZED", message: "secret" }] }) }, "send:expo_unauthorized"],
  [{ ok: false, status: 503, json: async () => null }, "send:expo_server_error"],
  [{ ok: true, json: async () => ({ errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }] }) }, "send:expo_push_too_many_experience_ids"],
  [{ ok: true, json: async () => ({ data: [{ status: "error", details: { error: "InvalidCredentials" } }] }) }, "send:expo_invalid_credentials"],
  [{ ok: true, json: async () => ({ data: [{ status: "ok" }] }) }, "send:expo_no_ticket_id"],
])("records Expo's own code when a push is refused, never its message or the token", async (reply, reason) => {
  mocks.fetch.mockResolvedValue(reply);
  await deliverMobileNotifications();
  expect(mocks.record).toHaveBeenCalledWith("system.mobile_push", "step_failed", expect.objectContaining({ reason }));
  expect(JSON.stringify(mocks.record.mock.calls)).not.toMatch(/secret|ExpoPushToken/);
  expect(mocks.updates).toContainEqual(expect.objectContaining({ status: "pending" }));
});

it("drops the whole stale backlog before claiming, so a new notification is not left behind it", async () => {
  const from = mocks.from.getMockImplementation()!;
  const dropped: unknown[] = [];
  mocks.from.mockImplementation((table: string) => {
    const chain = from(table) as Record<string, unknown>;
    if (table === "mobile_notification_events") return { ...chain, select: (columns: string) => columns === "id,business_id"
      ? { lt: () => ({ order: () => ({ limit: async () => ({ data: [{ id: "old", business_id: "business" }], error: null }) }) }) }
      : (chain.select as () => unknown)() };
    if (table === "mobile_notification_deliveries") return { ...chain, update: (value: unknown) => ({ in: (_c: string, ids: string[]) => ({ in: () => ({ select: async () => { dropped.push({ value, ids }); return { data: [{ id: "d-old", event_id: "old" }] }; },
      eq: () => ({ then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }) }), eq: () => chain }), eq: () => chain }) };
    return chain;
  });
  await deliverMobileNotifications();
  expect(dropped).toEqual([{ value: { status: "failed" }, ids: ["old"] }]);
  expect(mocks.record).toHaveBeenCalledWith("system.mobile_push", "expired", { businessId: "business", ref: "d-old" });
  // The claimed (fresh) notification is still sent.
  expect(mocks.fetch).toHaveBeenCalled();
});
