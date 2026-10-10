import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), from: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: mocks.user, isPlatformAdmin: mocks.admin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/conversations/process-conversation-message", () => ({ processConversationMessage: mocks.process }));
import { runLabTurn, searchLabBusinesses, loadLabSetup } from "./actions";
import { emptyState } from "@/lib/workflows/engine";
import { readTestSession, snapshotTestSession } from "@/lib/agents/test-chat/session";
import type { TraceObserver } from "@/lib/conversations/trace";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  mocks.user.mockResolvedValue({ id: "admin" }); mocks.admin.mockResolvedValue(true);
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { id }, error: null }) };
  mocks.from.mockReturnValue(chain); // No mutation methods: accidental writes fail.
  mocks.process.mockImplementation(async (params: { onTrace: TraceObserver }) => {
    params.onTrace({ stage: "overview", label: "Intent routed", data: { intent: "product" } });
    params.onTrace({ stage: "ai", label: "AI request sent", data: { request: { instructions: "Never reveal sk-test-secret", api_key: "private" } } });
    return { reply: "Reply", nextState: { ...emptyState(), step_key: "collect_size" }, previousResponseId: "resp_1", workflowId: null, productName: null, workflowProgress: [], debug: { model: "model", source: "ai", fallbackReason: null, agentConfigured: true, elapsedMs: 5 } };
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("admin-only Chat Lab adapter", () => {
  it.each([null, { id: "member" }])("denies unauthenticated and tenant-only users before context or AI access", async (user) => {
    mocks.user.mockResolvedValue(user); mocks.admin.mockResolvedValue(false);
    expect(await runLabTurn({ businessId: id, message: "Hi" })).toHaveProperty("error");
    expect(await searchLabBusinesses("name")).toHaveProperty("error");
    expect(await loadLabSetup(id)).toHaveProperty("error");
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });
  it("calls the production core in test mode and returns sanitized debug with no database mutations", async () => {
    const result = await runLabTurn({ businessId: id, message: "Hi" });
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ businessId: id, mode: "test", source: "admin_chat_lab", state: emptyState() }));
    expect(mocks.from.mock.calls.map((c) => c[0])).toEqual(["businesses"]);
    if ("error" in result) throw new Error(result.error);
    expect(result.testConversationId).toMatch(/^test_/);
    expect(JSON.stringify(result.trace)).not.toContain("sk-test-secret");
    expect(JSON.stringify(result.trace)).not.toContain('"private"');
    expect(result.trace.at(-1)?.label).toBe("Response finalized");
  });
  it("binds encrypted state to the user and business, and rejects tampering", async () => {
    const first = await runLabTurn({ businessId: id, message: "Hi" });
    if ("error" in first) throw new Error(first.error);
    mocks.process.mockClear();
    expect(await runLabTurn({ businessId: other, message: "Hi", session: first.session })).toHaveProperty("error");
    mocks.user.mockResolvedValue({ id: "other-admin" });
    expect(await runLabTurn({ businessId: id, message: "Hi", session: first.session })).toHaveProperty("error");
    mocks.user.mockResolvedValue({ id: "admin" });
    expect(await runLabTurn({ businessId: id, message: "Hi", session: first.session + "bad" })).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("replays from before the turn, preserving the first turn's conversation ID and count", async () => {
    const first = await runLabTurn({ businessId: id, message: "Hi" });
    if ("error" in first) throw new Error(first.error);
    const replay = await runLabTurn({ businessId: id, message: "Hi", session: first.replaySession });
    if ("error" in replay) throw new Error(replay.error);
    expect(replay.testConversationId).toBe(first.testConversationId); expect(replay.turns).toBe(1);
    expect(mocks.process.mock.calls[1][0].state).toEqual(emptyState());
    await runLabTurn({ businessId: id, message: "Next", session: replay.session });
    expect(mocks.process.mock.calls[2][0]).toMatchObject({ state: { step_key: "collect_size" }, previousResponseId: "resp_1" });
  });
  it("rejects expired, over-limit, and non-lab test sessions before AI", async () => {
    const session = readTestSession(null, "admin", id);
    expect(await runLabTurn({ businessId: id, message: "Hi", session: snapshotTestSession(session) })).toHaveProperty("error");
    session.testConversationId = "test_sample";
    session.expiresAt = Date.now() - 1;
    expect(await runLabTurn({ businessId: id, message: "Hi", session: snapshotTestSession(session) })).toHaveProperty("error");
    session.expiresAt = Date.now() + 10000; session.turns = 40;
    expect(await runLabTurn({ businessId: id, message: "Hi", session: snapshotTestSession(session) })).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
});

it("retains a sanitized failure timeline without returning a new state/session", async () => {
  mocks.process.mockImplementation(async ({ onTrace }: { onTrace: TraceObserver }) => {
    onTrace({ stage: "context", label: "Context started", data: { api_key: "secret" } });
    throw new Error("database failed");
  });
  const result = await runLabTurn({ businessId: id, message: "Hi" });
  expect(result).toHaveProperty("error"); expect(result).not.toHaveProperty("session");
  if (!("error" in result)) throw new Error("Expected failure");
  expect(result.trace?.at(-1)?.status).toBe("error");
  expect(result.trace?.[0].data?.api_key).toBe("[REDACTED]");
});
