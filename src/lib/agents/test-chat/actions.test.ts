import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  process: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  requireBusinessAccess: mocks.access,
}));
vi.mock("@/lib/conversations/process-agent-turn", () => ({
  processAgentTurn: mocks.process,
}));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: mocks.send }));
import { simulateAgentTurn } from "./actions";
import { readTestSession, sealTestSession, MAX_TEST_TURNS } from "./session";
import { emptyState } from "@/lib/workflows/engine";
const input = { slug: "zana", message: "Bluzë" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  mocks.user.mockResolvedValue({ id: "user-a" });
  mocks.access.mockResolvedValue({
    admin: false,
    business: { id: "business-a", auto_reply: false },
  });
  mocks.process.mockResolvedValue({
    reply: "Përshëndetje",
    nextState: { ...emptyState(), step_key: "collect_size" },
    previousResponseId: "resp_1",
    workflowId: null,
    debug: { source: "ai" },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("test chat action", () => {
  it("runs a turn with server-authorized business and no Meta sends", async () => {
    const result = await simulateAgentTurn(input);
    expect(result).toMatchObject({
      reply: "Përshëndetje",
      turns: 1,
      autoReplyEnabled: false,
    });
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "business-a",
        previousResponseId: null,
      }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("continues from sealed state and previous model response", async () => {
    const first = await simulateAgentTurn(input);
    if ("error" in first) throw Error(first.error);
    await simulateAgentTurn({ ...input, message: "M", session: first.session });
    expect(mocks.process).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: first.nextState,
        previousResponseId: "resp_1",
      }),
    );
  });
  it("rejects anonymous and unauthorized users before any model call", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await simulateAgentTurn(input)).toHaveProperty("error");
    expect(mocks.access).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: "user-b" });
    mocks.access.mockResolvedValue(null);
    expect(await simulateAgentTurn(input)).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("allows platform administrators through the same access check", async () => {
    mocks.access.mockResolvedValue({
      admin: true,
      business: { id: "business-a", auto_reply: true },
    });
    expect(await simulateAgentTurn(input)).toHaveProperty("reply");
  });
  it("rejects session replay in another tenant or by another user", async () => {
    const result = await simulateAgentTurn(input);
    if ("error" in result) throw Error(result.error);
    mocks.process.mockClear();
    mocks.access.mockResolvedValue({ business: { id: "business-b" } });
    expect(
      await simulateAgentTurn({ ...input, session: result.session }),
    ).toHaveProperty("error");
    mocks.access.mockResolvedValue({ business: { id: "business-a" } });
    mocks.user.mockResolvedValue({ id: "user-b" });
    expect(
      await simulateAgentTurn({ ...input, session: result.session }),
    ).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("rejects tampered and expired sessions", async () => {
    const first = await simulateAgentTurn(input);
    if ("error" in first) throw Error(first.error);
    mocks.process.mockClear();
    expect(
      await simulateAgentTurn({
        ...input,
        session: first.session.replace(/^v1/, "v0"),
      }),
    ).toHaveProperty("error");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3600001);
    expect(
      await simulateAgentTurn({ ...input, session: first.session }),
    ).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("reset starts without previous state/response context", async () => {
    await simulateAgentTurn(input);
    await simulateAgentTurn({ ...input, session: null });
    expect(mocks.process).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: emptyState(),
        previousResponseId: null,
      }),
    );
  });
  it("validates text and photo-only turns", async () => {
    expect(await simulateAgentTurn({ ...input, message: " " })).toHaveProperty(
      "error",
    );
    expect(
      await simulateAgentTurn({ ...input, message: "x".repeat(2001) }),
    ).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
    expect(
      await simulateAgentTurn({ ...input, message: "", hasMedia: true }),
    ).toHaveProperty("reply");
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({ hasPhoto: true }),
    );
  });
  it("bounds session length and handles processing errors", async () => {
    const s = readTestSession(null, "user-a", "business-a");
    const token = sealTestSession(
      { ...s, turns: MAX_TEST_TURNS - 1 },
      s.state,
      null,
    );
    expect(
      await simulateAgentTurn({ ...input, session: token }),
    ).toHaveProperty("error");
    mocks.process.mockRejectedValue(
      Error("internal credentials must not leak"),
    );
    expect(await simulateAgentTurn(input)).toEqual({
      error:
        "Prova nuk u përfundua. Kontrollo konfigurimin e agjentit dhe provo përsëri.",
    });
  });
});
