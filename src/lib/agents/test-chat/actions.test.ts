import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  record: vi.fn(),
  user: vi.fn(),
  access: vi.fn(),
  process: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  requireBusinessAccess: mocks.access,
}));
vi.mock("@/lib/conversations/process-conversation-message", () => ({
  processConversationMessage: mocks.process,
}));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: mocks.send }));
vi.mock("@/lib/setup/status", () => ({ loadSetupStatus: mocks.setup }));
vi.mock("@/lib/setup/record-test", () => ({ recordSetupTest: mocks.record }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { simulateAgentTurn } from "./actions";
import { readTestSession, sealTestSession, MAX_TEST_TURNS } from "./session";
import { emptyState } from "@/lib/workflows/engine";
import { sealAttachment } from "./attachments";
const input = { slug: "zana", message: "Bluzë" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.setup.mockResolvedValue({ available: true, signature: "config-a" });
  mocks.record.mockResolvedValue(true);
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
    productName: null,
    workflowProgress: [],
    debug: { source: "ai", agentConfigured: true },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("test chat action", () => {
  it("uses owned attachments as test context and carries them in checkpoints without collecting their text as profile fields", async () => {
    const attachment = sealAttachment({name:"photo.png",kind:"image",text:"A blue shirt"},"user-a","business-a");
    const first=await simulateAgentTurn({...input,message:"",attachments:[attachment.token]});
    if ("error" in first) throw Error(first.error);
    expect(mocks.process).toHaveBeenLastCalledWith(expect.objectContaining({hasPhoto:true,hasAttachments:true,attachmentContext:expect.stringContaining("A blue shirt")}));
    expect(readTestSession(first.session,"user-a","business-a").attachments?.[0].text).toBe("A blue shirt");
    await simulateAgentTurn({...input,message:"Po ngjyra?",session:first.session});
    expect(mocks.process).toHaveBeenLastCalledWith(expect.objectContaining({hasPhoto:false,hasAttachments:false,attachmentContext:expect.stringContaining("A blue shirt")}));
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects attachments from another tenant before processing a turn",async()=>{
    const attachment=sealAttachment({name:"private.txt",kind:"document",text:"private"},"user-a","other-business");
    expect(await simulateAgentTurn({...input,attachments:[attachment.token]})).toHaveProperty("error");
    expect(mocks.process).not.toHaveBeenCalled();
  });
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

it("records only a completed AI workflow, never inbox or CRM data", async () => {
  const first = await simulateAgentTurn(input);
  if ("error" in first) throw Error(first.error);
  mocks.process.mockResolvedValue({
    reply: "Gati",
    nextState: {
      ...emptyState(),
      product_id: "product-a",
      step_key: "order_ready",
      customer: { name: "Test", phone: "000", city: "Test", address: "Test" },
    },
    previousResponseId: "resp_2",
    workflowId: "workflow-a",
    debug: { source: "ai", agentConfigured: true },
  });
  const result = await simulateAgentTurn({ ...input, session: first.session });
  expect(result).toHaveProperty("setupTestPassed", true);
  expect(mocks.record).toHaveBeenCalledWith("business-a", "config-a");
  expect(mocks.send).not.toHaveBeenCalled();
});
it("requires a fresh test after configuration changes", async () => {
  const first = await simulateAgentTurn(input);
  if ("error" in first) throw Error(first.error);
  mocks.setup.mockResolvedValue({ available: true, signature: "changed" });
  const second = await simulateAgentTurn({ ...input, session: first.session });
  if ("error" in second) throw Error(second.error);
  expect(second.setupNotice).toBeTruthy();
  expect(
    readTestSession(second.session, "user-a", "business-a").setupSignature,
  ).toBeNull();
  expect(mocks.record).not.toHaveBeenCalled();
});
it("still certifies when the final turn is fallback after an earlier AI reply", async () => {
  const first = await simulateAgentTurn(input);
  if ("error" in first) throw Error(first.error);
  mocks.process.mockResolvedValue({
    reply: "Fallback",
    nextState: {
      ...emptyState(),
      product_id: "product-a",
      step_key: "order_ready",
      customer: { name: "Test", phone: "000", city: "Test", address: "Test" },
    },
    previousResponseId: null,
    workflowId: "wf",
    debug: { source: "fallback", agentConfigured: true },
  });
  const result = await simulateAgentTurn({ ...input, session: first.session });
  expect(result).toHaveProperty("setupTestPassed", true);
  expect(mocks.record).toHaveBeenCalledWith("business-a", "config-a");
});
it("never certifies a session with only fallback replies or incomplete customer details", async () => {
  mocks.process.mockResolvedValue({
    reply: "Fallback",
    nextState: {
      ...emptyState(),
      product_id: "product-a",
      step_key: "order_ready",
      customer: { name: "Test", phone: "000", city: "Test", address: "Test" },
    },
    previousResponseId: null,
    workflowId: "wf",
    debug: { source: "fallback", agentConfigured: true },
  });
  expect(await simulateAgentTurn(input)).toHaveProperty(
    "setupTestPassed",
    false,
  );
  expect(mocks.record).not.toHaveBeenCalled();
});
it("certifies a catalog-only business after a grounded AI document reply", async () => {
  mocks.setup.mockResolvedValue({
    available: true,
    signature: "config-a",
    productCount: 0,
    catalogCount: 1,
  });
  mocks.process.mockResolvedValue({
    reply: "Katalogu: https://agjenti.app/api/catalogs/share/opaque",
    nextState: emptyState(),
    previousResponseId: null,
    workflowId: null,
    debug: {
      source: "ai",
      agentConfigured: true,
      retrievedCatalogIds: ["doc"],
    },
  });
  expect(await simulateAgentTurn(input)).toHaveProperty(
    "setupTestPassed",
    true,
  );
  expect(mocks.record).toHaveBeenCalledWith("business-a", "config-a");
  expect(mocks.send).not.toHaveBeenCalled();
});
it("certifies a knowledge-only business after an AI reply using active knowledge, without an order", async () => {
  mocks.setup.mockResolvedValue({ available: true, signature: "config-a", productCount: 0, knowledgeCount: 2 });
  mocks.process.mockResolvedValue({ reply: "We deliver in two days.", nextState: emptyState(), previousResponseId: null, workflowId: null, debug: { source: "ai", agentConfigured: true, knowledgeCount: 2 } });
  expect(await simulateAgentTurn(input)).toHaveProperty("setupTestPassed", true);
  expect(mocks.record).toHaveBeenCalledWith("business-a", "config-a");
  mocks.record.mockClear();
  mocks.process.mockResolvedValue({ reply: "No business context.", nextState: emptyState(), previousResponseId: null, workflowId: null, debug: { source: "ai", agentConfigured: true, knowledgeCount: 0 } });
  expect(await simulateAgentTurn(input)).toHaveProperty("setupTestPassed", false);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("does not certify catalog clarification or document-only test for a product business", async () => {
  mocks.setup.mockResolvedValue({
    available: true,
    signature: "config-a",
    productCount: 0,
    catalogCount: 1,
  });
  mocks.process.mockResolvedValue({
    reply: "Në cilin shtet?",
    nextState: emptyState(),
    previousResponseId: null,
    workflowId: null,
    debug: {
      source: "fallback",
      agentConfigured: true,
      retrievedCatalogIds: [],
    },
  });
  expect(await simulateAgentTurn(input)).toHaveProperty(
    "setupTestPassed",
    false,
  );
  mocks.setup.mockResolvedValue({
    available: true,
    signature: "config-a",
    productCount: 1,
    catalogCount: 1,
  });
  mocks.process.mockResolvedValue({
    reply: "Katalogu",
    nextState: emptyState(),
    previousResponseId: null,
    workflowId: null,
    debug: {
      source: "ai",
      agentConfigured: true,
      retrievedCatalogIds: ["doc"],
    },
  });
  expect(await simulateAgentTurn(input)).toHaveProperty(
    "setupTestPassed",
    false,
  );
  expect(mocks.record).not.toHaveBeenCalled();
});
