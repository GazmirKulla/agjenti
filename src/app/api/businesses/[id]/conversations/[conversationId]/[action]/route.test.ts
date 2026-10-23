import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  getUser: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: mocks.admin }));
vi.mock("@/lib/setup/status", () => ({ loadSetupStatus: mocks.setup }));
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
  mocks.setup.mockResolvedValue({ connected: true, launched: true });
  mocks.rpc.mockResolvedValue({ data: 5, error: null });
  const query = {
    update: mocks.update,
    delete: mocks.delete,
    eq: mocks.eq,
    in: vi.fn(() => query),
    select: mocks.select,
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.delete.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
  mocks.admin.mockResolvedValue(true);
  mocks.maybeSingle.mockResolvedValue({
    data: { id: "conversation-a", revision: 4 },
    error: null,
  });
});
describe("conversation status actions", () => {
  it("clears messages through the atomic operation without deleting the conversation", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect((await request("clear-messages")).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("clear_conversation_messages", {
      p_business_id: "business-a",
      p_conversation_id: "conversation-a",
    });
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reports a failed clear without claiming success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await request("clear-messages")).status).toBe(500);
  });
  it("cannot clear a missing or other-tenant conversation", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await request("clear-messages")).status).toBe(404);
  });
  it("requires business access before clearing messages", async () => {
    mocks.admin.mockResolvedValue(false);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await request("clear-messages")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires authentication before clearing messages", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await request("clear-messages")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
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
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await request()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each(["pause", "complete"])(
    "persists %s only within the requested business",
    async (action) => {
      expect((await request(action)).status).toBe(200);
      expect(mocks.eq).toHaveBeenCalledWith("business_id", "business-a");
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ auto_reply: false }),
      );
    },
  );
  it("deletes the conversation only within the requested business", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: "conversation-a",
          channel: "whatsapp",
          whatsapp_participant_id: "3556",
          whatsapp_connection_id: "conn-a",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: "conversation-a" }, error: null });
    expect((await request("delete")).status).toBe(200);
    expect(mocks.delete).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("id", "conversation-a");
    expect(mocks.eq).toHaveBeenCalledWith("business_id", "business-a");
  });
  it("does not claim success when the database rejects the delete", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: "conversation-a",
          channel: "instagram",
          instagram_participant_id: "ig",
          instagram_connection_id: "conn-a",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database unavailable" },
      });
    const response = await request("delete");
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty("error");
  });
  it.each(["unknown", "__proto__"])(
    "rejects the invalid action %s without writing",
    async (action) => {
      expect((await request(action)).status).toBe(404);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
    },
  );
});

it("resumes through one authorized revision-bound RPC without direct writes", async () => {
  expect((await request("resume")).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("resume_conversation_agent", {
    p_business: "business-a", p_user: "user-a", p_conversation: "conversation-a", p_revision: 4,
  });
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each(["stale_state", "state_missing", "state_invalid", "queue_transition_conflict", "delivery_unverified"])("rejects resume: %s", async message => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message } });
  expect((await request("resume")).status).toBe(409);
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each([["unauthorized", undefined, 403], ["invalid_conversation", undefined, 404], ["busy", "55P03", 409], ["deadlock", "40P01", 409]] as const)("maps RPC rejection %s without success", async (message, code, status) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message, code } });
  expect((await request("resume")).status).toBe(status);
});

it.each([{ data: null, error: null, status: 404 }, { data: null, error: { message: "DB failure" }, status: 500 }])("rejects a missing or failed state read", async ({ data, error, status }) => {
  mocks.maybeSingle.mockResolvedValue({ data, error });
  expect((await request("resume")).status).toBe(status);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each([null, false, 4, 6])("does not treat an unconfirmed RPC result as success: %s", async data => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect((await request("resume")).status).toBe(500);
});

it("does not retry an unknown resume outcome", async () => {
  mocks.rpc.mockRejectedValue(new Error("Response lost"));
  expect((await request("resume")).status).toBe(500);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("cannot resume automatic replies before required setup", async () => {
  mocks.setup.mockResolvedValue({
    available: true,
    connected: false,
    launched: false,
  });
  expect((await request("resume")).status).toBe(409);
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each(["conversation_states", "workflow_inbound_queue"])("resume never claims success after %s write failure", async failedTable => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "injected_write_failure" } });
  mocks.from.mockImplementation((table: string) => {
    let writing = false;
    const query = {
      select: () => query, eq: () => query, in: () => query,
      update: () => { writing = true; return query; },
      maybeSingle: async () => ({ data: table === "conversation_states" ? { revision: 4, collected: { staffHandoff: true } } : { id: "conversation-a" }, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: writing && table === failedTable ? { message: "injected_write_failure" } : null })),
    };
    return query;
  });
  expect((await request("resume")).status).toBe(500);
});
