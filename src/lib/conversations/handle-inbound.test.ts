import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  process: vi.fn(),
  send: vi.fn(),
  whatsappSend: vi.fn(),
  profile: vi.fn(),
  rpc: vi.fn(),
  aiReaction: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("./process-conversation-message", () => ({ processConversationMessage: mocks.process }));
vi.mock("./ai-reaction-runtime",()=>({runAiReaction:mocks.aiReaction}));
vi.mock("@/lib/crypto/tokens", () => ({
  decryptSecret: () => "fake-meta-token",
}));
vi.mock("@/lib/whatsapp/api", () => ({ sendWhatsAppText: mocks.whatsappSend }));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: mocks.send }));
vi.mock("@/lib/instagram/user-profile", () => ({
  fetchInstagramUserProfile: mocks.profile,
}));

import { handleInboundMessage } from "./handle-inbound";
import { runWorkflowQueue, type WorkflowJob } from "./workflow-queue";
import { emptyState } from "@/lib/workflows/engine";
import { migrateContext } from "@/lib/workflows/context";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
const message: NormalizedIncomingMessage = {
  channel: "instagram",
  externalMessageId: "msg-a",
  externalParticipantId: "customer-ig",
  phone: null,
  senderUsername: null,
  senderDisplayName: null,
  text: "Bluzë",
  attachments: [],
  timestamp: new Date("2026-10-03T10:00:00Z"),
  contextMetadata: { instagramAccountId: "ig-a" },
  rawPayload: {},
};
let deliveryAttempt: {status:string;reply:string} | null;
let outboundResult: { data: {body:string;source:string;delivery_status:string} | null; error: {message:string} | null };
let historyResult: {data: unknown[]; error: {message:string} | null} | undefined;
let paused = false;
let auto = true;
let conversationAuto: boolean | null = null;
let businessPolicyError: { code: string; message: string } | null = null;
let newConversation = false;
let webhookInsertCode: string | null = null;
let savedState = emptyState();
let writes: { table: string; operation: string; data: unknown }[] = [];
let inboundResult: { data: { id: string } | null; error: { code: string; message: string } | null };
let inboundException: Error | null;
let failInboundId: string | null;
let duplicateResult: { data: { id: string } | null; error: { code: string; message: string } | null };
let webhookEvents: Set<string>;
let duplicateFilters: Record<string, unknown>;
let originalReceipt: { data: { conversation_id: string } | null; error: { message: string } | null };
let originalStatus: string;
let conversationLookups: Record<string, unknown>[];
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  paused = false;
  historyResult = undefined;
  outboundResult = {data:null,error:null};
  deliveryAttempt = null;
  auto = true;
  conversationAuto = null;
  businessPolicyError = null;
  newConversation = false;
  webhookInsertCode = null;
  savedState = emptyState();
  writes = [];
  inboundResult = { data: { id: "inbound-a" }, error: null };
  inboundException = null;
  failInboundId = null;
  duplicateResult = { data: { id: "inbound-a" }, error: null };
  webhookEvents = new Set();
  duplicateFilters = {};
  originalReceipt = { data: null, error: null };
  originalStatus = "active";
  conversationLookups = [];
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.aiReaction.mockResolvedValue({decision:{kind:'none',reason:'synthetic_disabled'}});
  mocks.process.mockResolvedValue({
    reply: "Përgjigje nga pipeline",
    nextState: { ...emptyState(), step_key: "collect_size" },
    previousResponseId: "resp_new",
    workflowId: "workflow-a",
  });
  mocks.send.mockResolvedValue({ ok: true, messageId: "meta-reply" });
  mocks.whatsappSend.mockResolvedValue({ ok: true, messageId: "wa-reply" });
  mocks.profile.mockResolvedValue({ username: "customer_ig", name: "Klient Test" });
  mocks.from.mockImplementation((table: string) => {
    let op = "select";
    let columns = "";
    let inserted: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === "businesses" && op === "select" && businessPolicyError) return { data: null, error: businessPolicyError };
      if (table === "conversations" && op === "select") conversationLookups.push({ ...filters });
      if (table === "conversations" && op === "select" && newConversation) return { data: null, error: null };
      if (table === "messages" && op === "insert" && inserted.direction === "inbound") {
        if (inserted.external_message_id === failInboundId) return { data: null, error: { code: "57014", message: "timeout" } };
        if (inboundException) throw inboundException;
        return inboundResult;
      }
      if (table === "workflow_inbound_queue" && op === "select") return {data:deliveryAttempt,error:null};
      if (table === "messages" && op === "select" && columns.startsWith("body,direction")) return historyResult ?? {data: [...(savedState.recentMessages ?? [])].reverse().map((row, i) => ({ body: row.content, direction: row.role === "user" ? "inbound" : "outbound", source: row.role === "user" ? "customer" : "agent", delivery_status: "sent", external_message_id: `history-${i}` })), error:null};
      if (table === "messages" && op === "select" && filters.direction === "outbound") return outboundResult;
      if (table === "messages" && op === "select" && columns === "conversation_id") return originalReceipt;
      if (table === "messages" && op === "select") {
        duplicateFilters = filters;
        return duplicateResult;
      }
      if (table === "webhook_events") {
        if (op === "select") return { data: webhookEvents.has(String(filters.external_event_id)) ? { id: "event-a" } : null, error: null };
        if (op === "insert") {
          const code = webhookInsertCode ?? (webhookEvents.has(String(inserted.external_event_id)) ? "23505" : null);
          if (code) return { data: null, error: { code, message: "Insert failed" } };
          webhookEvents.add(String(inserted.external_event_id));
        }
      }
      return ({
      error: table === "webhook_events" && op === "insert" && webhookInsertCode ? { code: webhookInsertCode, message: "Insert failed" } : null,
      data:
        table === "webhook_events"
          ? op === "select"
            ? null
            : { id: "event-a" }
          : (table === "instagram_connections" || table === "whatsapp_connections")
            ? {
                id: "connection-a",
                business_id: "business-a",
                ig_user_id: "ig-a",
                phone_number_id: "123456",
                access_token_ciphertext: "sealed",
                status: "connected",
              }
            : table === "conversations"
                ? {
                    id: typeof filters.id === "string" ? filters.id : "conversation-a",
                    status: paused ? "paused" : originalStatus,
                    auto_reply: conversationAuto,
                    openai_previous_response_id: "resp_old",
                  }
                : table === "businesses"
                  ? { auto_reply: auto }
                  : table === "conversation_states"
                    ? { collected: savedState, workflow_id: null }
                    : { id: "row-a" },
    });
    };
    const chain = {
      select: vi.fn((value: string) => {columns=value; return chain;}),
      eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return chain; }),
      neq: vi.fn(() => chain),
      or: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      not: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: async () => result(),
      single: async () => result(),
      throwOnError: async () => result(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
      insert: (data: unknown) => {
        op = "insert";
        inserted = data as Record<string, unknown>;
        writes.push({ table, operation: op, data });
        return chain;
      },
      update: (data: unknown) => {
        op = "update";
        writes.push({ table, operation: op, data });
        return chain;
      },
      upsert: (data: unknown) => {
        op = "upsert";
        writes.push({ table, operation: op, data });
        return chain;
      },
    };
    return chain;
  });
});

const queuedJob = () => ({ id: 17, business_id: "business-a", connection_id: "connection-a", participant_id: message.externalParticipantId, payload: message, status: "processing", lease_token: "lease-a", reply: null });

it.each([false, true])("retry uses original conversation, never a newer same-participant thread; receipt=%s", async fromReceipt => {
  originalStatus = "completed";
  if (fromReceipt) originalReceipt = { data: { conversation_id: "original-conversation" }, error: null };
  const job: WorkflowJob = { ...queuedJob(), ...(fromReceipt ? {} : { conversation_id: "original-conversation" }) };
  await handleInboundMessage(message, job);
  expect(conversationLookups[0]).toMatchObject({ id: "original-conversation", business_id: "business-a" });
  expect(mocks.rpc).toHaveBeenCalledWith("bind_workflow_inbound", expect.objectContaining({ p_conversation: "original-conversation" }));
  expect(writes.some(w => w.table === "conversations" && w.operation === "insert")).toBe(false);
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each([false, null])("does not persist inbound or execute before binding is confirmed (%s)", async data => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  await expect(handleInboundMessage(message, queuedJob())).rejects.toThrow("binding not confirmed");
  expect(writes.some(w => w.table === "messages" && w.operation === "insert")).toBe(false);
  expect(mocks.process).not.toHaveBeenCalled();
});

it("does not fall back to another conversation after the original identity read fails", async () => {
  originalReceipt = { data: null, error: { message: "unavailable" } };
  await expect(handleInboundMessage(message, queuedJob())).rejects.toThrow("identity unavailable");
  expect(conversationLookups).toHaveLength(0);
  expect(mocks.process).not.toHaveBeenCalled();
});

it("does not recreate a missing pinned conversation", async () => {
  newConversation = true;
  await expect(handleInboundMessage(message, { ...queuedJob(), conversation_id: "gone" })).rejects.toThrow("original conversation unavailable");
  expect(writes.some(w => w.table === "conversations" && w.operation === "insert")).toBe(false);
});
describe.each(["instagram", "whatsapp"] as const)("%s policy reads through the real inbound/queue boundary", channel => {
  const job = (): WorkflowJob => ({ ...queuedJob(), payload: {
    ...message, channel, timestamp: new Date(),
    contextMetadata: channel === "instagram" ? { instagramAccountId: "ig-a" } : { whatsappPhoneNumberId: "123456" },
  } });
  const claim = (...jobs: WorkflowJob[]) => {
    // PostgreSQL owns lease eligibility/retry limits; do not emulate that engine here.
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_workflow_transport") return { data: jobs.length ? [jobs.shift()] : [], error: null };
      if (name === "workflow_inbound_batch_wait_ms") return { data: 0, error: null };
      if (name === "begin_workflow_send" || name === "bind_workflow_inbound") return { data: true, error: null };
      if (["prepare_workflow_reply", "finish_workflow_send"].includes(name)) return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
  };
  const expectNoExecution = () => {
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.whatsappSend).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("prepare_workflow_reply");
    expect(writes.some(write => write.table === "conversation_states")).toBe(false);
  };

  it("retries an inherited policy read failure without advancing state or releasing the job as ignored", async () => {
    businessPolicyError = { code: "08006", message: "database policy read failed" };
    const input = job();
    const before = Date.now();
    const stateBefore = structuredClone(savedState);
    claim(input);
    expect(await runWorkflowQueue(1)).toBe(0);
    expectNoExecution();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(writes.filter(write => write.table !== "workflow_inbound_queue")).toEqual([]);
    expect(savedState).toEqual(stateBefore);
    expect(input.status).toBe("processing");
    const updates = writes.filter(write => write.table === "workflow_inbound_queue");
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({ leased_until: expect.any(String), error: "Workflow processing failed" });
    const retryAt = Date.parse((updates[0].data as { leased_until: string }).leased_until);
    expect(retryAt).toBeGreaterThanOrEqual(before + 30000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 30000);
    const queue = mocks.from.mock.results[mocks.from.mock.calls.findLastIndex(([table]) => table === "workflow_inbound_queue")].value;
    expect(queue.eq.mock.calls).toEqual([["id", input.id], ["lease_token", input.lease_token], ["status", "processing"]]);
    // No fresh claim means no local replay, including while the lease is still held.
    expect(await runWorkflowQueue(1)).toBe(0);
    expectNoExecution();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(writes.filter(write => write.table === "workflow_inbound_queue")).toHaveLength(1);
  });

  it.each([
    { override: null, business: false, allowed: false },
    { override: false, business: true, allowed: false },
    { override: null, business: true, allowed: true },
    { override: true, business: false, allowed: true },
  ])("preserves verified policy precedence: conversation=$override business=$business", async ({ override, business, allowed }) => {
    conversationAuto = override;
    auto = business;
    claim(job());
    expect(await runWorkflowQueue(1)).toBe(1);
    if (!allowed) {
      expectNoExecution();
      expect(writes).toContainEqual({ table: "workflow_inbound_queue", operation: "update", data: { status: "ignored", leased_until: null } });
    } else {
      expect(mocks.process).toHaveBeenCalledOnce();
      expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business-a", source: channel }));
      expect(channel === "instagram" ? mocks.send : mocks.whatsappSend).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledWith("finish_workflow_send", expect.objectContaining({ p_ok: true }));
    }
  });

  it("recovers the same inbound with a new lease and produces only one state commit and provider send", async () => {
    businessPolicyError = { code: "08006", message: "temporary failure" };
    const input = job();
    claim(input);
    expect(await runWorkflowQueue(1)).toBe(0);
    expectNoExecution();
    businessPolicyError = null;
    // An inbound saved by an earlier delivery must still be deduplicated on recovery.
    inboundResult = { data: null, error: { code: "23505", message: "already saved" } };
    const retry = { ...input, lease_token: "lease-retry" };
    claim(retry);
    expect(await runWorkflowQueue(1)).toBe(1);
    expect(await runWorkflowQueue(1)).toBe(0);
    expect(duplicateFilters).toMatchObject({ business_id: "business-a", conversation_id: "conversation-a", external_message_id: message.externalMessageId,
      [channel === "instagram" ? "instagram_connection_id" : "whatsapp_connection_id"]: "connection-a" });
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "prepare_workflow_reply")).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_id: input.id, p_token: "lease-retry" }));
    expect(mocks.send.mock.calls.length + mocks.whatsappSend.mock.calls.length).toBe(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finish_workflow_send")).toHaveLength(1);
  });

  it("keeps staff ownership when a previously failing policy read recovers", async () => {
    businessPolicyError = { code: "08006", message: "temporary failure" };
    const input = job();
    claim(input);
    expect(await runWorkflowQueue(1)).toBe(0);
    businessPolicyError = null;
    paused = true;
    claim({ ...input, lease_token: "lease-retry" });
    expect(await runWorkflowQueue(1)).toBe(1);
    expectNoExecution();
    expect(writes).toContainEqual({ table: "workflow_inbound_queue", operation: "update", data: { status: "ignored", leased_until: null } });
  });

  it("does not persist policy OFF on a new conversation when the initial policy read fails", async () => {
    newConversation = true;
    businessPolicyError = { code: "08006", message: "temporary failure" };
    claim(job());
    expect(await runWorkflowQueue(1)).toBe(0);
    expectNoExecution();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(writes.some(write => write.table === "conversations" && write.operation === "insert")).toBe(false);
  });
});
it("persists the four original messages and generates one combined turn", async () => {
 const texts = ["Ckemi", "Si jeni", "Dua te porosis montesori", "E keni ne gjendje?"];
 const originals = texts.map((text, i) => ({ ...message, externalMessageId: i ? `msg-${i}` : message.externalMessageId, text }));
 const job = { ...queuedJob(), batch_payloads: originals };
 await handleInboundMessage(message, job);
 expect(writes.filter(w => w.table === "messages").map(w => w.data)).toEqual(originals.map(original => expect.objectContaining({ external_message_id: original.externalMessageId, body: original.text })));
 expect(mocks.process).toHaveBeenCalledOnce();
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ message: texts.join("\n") }));
 expect(mocks.rpc.mock.calls.filter(([name]) => name === "prepare_workflow_reply")).toHaveLength(1);
 expect(job.status).toBe("prepared");
 expect(mocks.send).not.toHaveBeenCalled();
});
it("does not process a partly saved batch and resumes it without changing membership", async () => {
 const originals = [message, { ...message, externalMessageId: "second", text: "Montessori" }];
 const job = { ...queuedJob(), batch_payloads: originals };
 failInboundId = "second";
 await expect(handleInboundMessage(message, job)).rejects.toThrow("message_insert");
 expect(mocks.process).not.toHaveBeenCalled();
 expect(mocks.rpc).not.toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
 failInboundId = null;
 inboundResult = { data: null, error: { code: "23505", message: "already saved" } };
 await handleInboundMessage(message, job);
 expect(mocks.process).toHaveBeenCalledOnce();
 expect(job.batch_payloads).toEqual(originals);
});
describe("inbound persistence boundary", () => {
  it.each([false, true])("stops before processing on database error, queued=%s", async queued => {
    inboundResult = { data: null, error: { code: "XX000", message: "Private database details" } };
    await expect(handleInboundMessage(message, queued ? queuedJob() : undefined)).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(writes.filter(w => w.table === "conversation_states")).toEqual([]);
    expect(webhookEvents.size).toBe(0);
  });
  it.each([false, true])("retries after a failed save without poisoning the event receipt, queued=%s", async queued => {
    inboundResult = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(handleInboundMessage(message, queued ? queuedJob() : undefined)).rejects.toThrow();
    inboundResult = { data: { id: "inbound-a" }, error: null };
    await handleInboundMessage(message, queuedJob());
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects an unconfirmed insert with no ID, queued=%s", async queued => {
    inboundResult = { data: null, error: null };
    await expect(handleInboundMessage(message, queued ? queuedJob() : undefined)).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each([false, true])("recovers a stored inbound after a transport timeout, queued=%s", async queued => {
    inboundException = new TypeError("fetch failed: private details");
    await expect(handleInboundMessage(message, queued ? queuedJob() : undefined)).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
    inboundException = null;
    inboundResult = { data: null, error: { code: "23505", message: "duplicate" } };
    await handleInboundMessage(message, queuedJob());
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(duplicateFilters).toEqual({ business_id: "business-a", conversation_id: "conversation-a", instagram_connection_id: "connection-a", external_message_id: "msg-a", direction: "inbound", source: "customer" });
  });
  it.each([null, { code: "57014", message: "lookup timeout" }])("rejects an unverified unique violation (%j)", async error => {
    inboundResult = { data: null, error: { code: "23505", message: "duplicate" } };
    duplicateResult = { data: null, error };
    await expect(handleInboundMessage(message, queuedJob())).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
  });
  it("records a safe correlation identifier and database code without database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      inboundResult = { data: null, error: { code: "57014", message: "private token and customer data" } };
      await expect(handleInboundMessage(message, queuedJob())).rejects.toThrow("workflow-job:17");
      expect(log).toHaveBeenCalledWith("[inbound] persistence failed", expect.objectContaining({ correlationId: "workflow-job:17", stage: "message_insert", databaseCode: "57014", conversationId: "conversation-a" }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("private token");
    } finally { log.mockRestore(); }
  });
  it("resumes a saved inbound when its legacy event receipt failed", async () => {
    webhookInsertCode = "XX000";
    await expect(handleInboundMessage(message)).rejects.toThrow("event_receipt");
    expect(mocks.process).not.toHaveBeenCalled();
    expect(webhookEvents.size).toBe(0);
    webhookInsertCode = null;
    inboundResult = { data: null, error: { code: "23505", message: "already stored" } };
    await handleInboundMessage(message, queuedJob());
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
  });
  it("verifies WhatsApp duplicates against the WhatsApp connection", async () => {
    inboundResult = { data: null, error: { code: "23505", message: "duplicate" } };
    const incoming = { ...message, channel: "whatsapp" as const, contextMetadata: { whatsappPhoneNumberId: "123456" } };
    await handleInboundMessage(incoming, { ...queuedJob(), payload: incoming });
    expect(duplicateFilters).toMatchObject({ whatsapp_connection_id: "connection-a" });
    expect(duplicateFilters).not.toHaveProperty("instagram_connection_id");
  });
});
describe("real inbound integration with shared processor", () => {
  it("prepares the shared next state and exact reply for queue delivery", async () => {
    const job = queuedJob();
    await handleInboundMessage(message, job);
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({
      persistedWorkflowId: null, businessId: "business-a", message: "Bluzë", hasPhoto: false,
      state: { ...migrateContext(emptyState()), recentMessages: [] }, previousResponseId: "resp_old",
    }));
    expect(writes.some(w => w.table === "customers")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({
      p_workflow: "workflow-a", p_state: expect.objectContaining({ step_key: "collect_size" }),
      p_reply: "Përgjigje nga pipeline", p_response: "resp_new",
    }));
    expect(job.status).toBe("prepared");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not create a CRM customer on first inbound message", async () => {
    // Force new conversation path: open lookup returns null.
    mocks.from.mockImplementation((table: string) => {
      let op = "select";
      let selectCount = 0;
      const result = () => {
        if (table === "webhook_events") {
          return {
            error: null,
            data: op === "select" ? null : { id: "event-a" },
          };
        }
        if ((table === "instagram_connections" || table === "whatsapp_connections")) {
          return {
            error: null,
            data: {
              id: "connection-a",
              business_id: "business-a",
              ig_user_id: "ig-a",
                phone_number_id: "123456",
              access_token_ciphertext: "sealed",
              status: "connected",
            },
          };
        }
        if (table === "conversations") {
          selectCount += 1;
          // first open lookup + completed lookup => null; insert returns id
          if (op === "insert") {
            return { error: null, data: { id: "conversation-new" } };
          }
          return { error: null, data: null };
        }
        if (table === "businesses") {
          return { error: null, data: { auto_reply: false } };
        }
        return { error: null, data: { id: "row-a" } };
      };
      const chain = {
        select: vi.fn(() => {
          op = "select";
          return chain;
        }),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      not: vi.fn(() => chain),
        in: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        insert: (data: unknown) => {
          op = "insert";
          writes.push({ table, operation: "insert", data });
          return chain;
        },
        update: (data: unknown) => {
          op = "update";
          writes.push({ table, operation: "update", data });
          return chain;
        },
        upsert: (data: unknown) => {
          op = "upsert";
          writes.push({ table, operation: "upsert", data });
          return chain;
        },
      };
      void selectCount;
      return chain;
    });
    await handleInboundMessage({
      ...message,
      externalMessageId: "msg-new-thread",
    });
    expect(writes.some((w) => w.table === "customers")).toBe(false);
    expect(writes).toContainEqual({
      table: "conversations",
      operation: "insert",
      data: expect.objectContaining({
        customer_id: null,
        instagram_participant_id: "customer-ig",
        participant_username: "customer_ig",
      }),
    });
  });
  it("preserves the paused/auto-off production gate", async () => {
    paused = true;
    await handleInboundMessage(message);
    paused = false;
  outboundResult = {data:null,error:null};
  deliveryAttempt = null;
    auto = false;
    await handleInboundMessage({ ...message, externalMessageId: "second" });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps Meta dashboard synthetic events out of real conversations", async () => {
    await handleInboundMessage({
      ...message,
      contextMetadata: { metaDashboardTest: true },
    });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(writes.every((w) => w.table === "webhook_events")).toBe(true);
  });
  it("ignores repeated Meta dashboard tests with the same mid", async () => {
    let seen = false;
    mocks.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: async () =>
          table === "webhook_events" && seen
            ? { error: null, data: { id: "event-existing" } }
            : { error: null, data: null },
        insert: (data: unknown) => {
          seen = true;
          writes.push({ table, operation: "insert", data });
          return chain;
        },
      };
      return chain;
    });
    const synthetic = {
      ...message,
      externalMessageId: "random_mid",
      contextMetadata: { metaDashboardTest: true },
    };
    await handleInboundMessage(synthetic);
    await handleInboundMessage(synthetic);
    expect(writes).toHaveLength(1);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});

it("pauses a visual handoff before sending and preserves its collected state", async () => {
  const nextState = { ...emptyState(), visual: { versionId: "v1", nodeId: "staff", status: "handoff" as const, awaiting: false, visited: ["start", "staff"], values: { email: "demo@example.test" } } };
  mocks.process.mockResolvedValue({ reply: "Kaloi te stafi", nextState, previousResponseId: null, workflowId: null, handoff: true });
  await handleInboundMessage(message, queuedJob());
  expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_handoff: true, p_state: nextState }));
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.aiReaction).not.toHaveBeenCalled();
});
it("optional AI reaction failure cannot undo or retry the prepared normal reply", async () => {
  mocks.aiReaction.mockImplementation(async () => {
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_reply: "Përgjigje nga pipeline" }));
    throw new Error("Synthetic reaction unavailable");
  });
  const job = queuedJob();
  await expect(handleInboundMessage({ ...message, text: "Faleminderit" }, job)).resolves.toBeUndefined();
  expect(mocks.aiReaction).toHaveBeenCalledWith(expect.objectContaining({ messageId: "inbound-a", jobId: job.id, leaseToken: job.lease_token }));
  expect(job.status).toBe("prepared");
  expect(job.reply).toBe("Përgjigje nga pipeline");
  expect(mocks.process).toHaveBeenCalledOnce();
});
it("allows an explicitly resumed handoff to start a new run without erasing collected data", async () => {
  savedState = { ...emptyState(), visual: { versionId: "v1", nodeId: "staff", status: "handoff", awaiting: false, visited: ["staff"], values: { email: "demo@example.test" } } };
  await handleInboundMessage(message, queuedJob());
  expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ visual: expect.objectContaining({ status: "completed", values: { email: "demo@example.test" } }), completedVisual: savedState.visual }) }));
});
it("does not execute the same webhook twice when concurrent inserts collide", async () => {
  webhookInsertCode = "23505";
  await handleInboundMessage(message);
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("does not execute a message whose event cannot be persisted", async () => {
  webhookInsertCode = "XX000";
  await expect(handleInboundMessage(message)).rejects.toThrow();
  expect(mocks.process).not.toHaveBeenCalled();
});

it("keeps automatic replies on for advisory workflow handoffs",async()=>{
 const nextState={...emptyState(),visual:{versionId:"v1",nodeId:"staff",status:"handoff" as const,awaiting:false,visited:["staff"],values:{},advisory:true}};
 mocks.process.mockResolvedValue({reply:"Kontaktoni stafin",nextState,previousResponseId:null,workflowId:null,handoff:true,advisoryHandoff:true});
 await handleInboundMessage(message, queuedJob());
 expect(writes).not.toContainEqual({table:"conversations",operation:"update",data:{status:"paused",auto_reply:false}});
 expect(mocks.send).not.toHaveBeenCalled();
 expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply",expect.objectContaining({p_handoff:false}));
});
it("preserves the advisory cursor on the next live inbound turn",async()=>{
 savedState={...emptyState(),visual:{versionId:"v1",nodeId:"staff",status:"handoff",awaiting:false,visited:["staff"],values:{},advisory:true}};
 await handleInboundMessage(message, queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({state:expect.objectContaining({visual:savedState.visual})}));
});

 it("prepares WhatsApp persistence separately from Instagram for queue delivery", async () => {
  mocks.whatsappSend.mockResolvedValue({ ok: true, messageId: "wamid.reply" });
  const incoming = { ...message, channel: "whatsapp" as const, externalParticipantId: "355691234567", senderDisplayName: "Ana", contextMetadata: { whatsappPhoneNumberId: "123456" } };
  await handleInboundMessage(incoming, { ...queuedJob(), participant_id: incoming.externalParticipantId, payload: incoming });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.whatsappSend).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_conversation: "conversation-a" }));
  expect(writes).toContainEqual(expect.objectContaining({ table: "messages", data: expect.objectContaining({ whatsapp_connection_id: "connection-a", direction: "inbound" }) }));
  expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ source: "whatsapp", customerIdentity: expect.objectContaining({ channel: "whatsapp" }) }));
 });

it("commits a non-pilot Instagram turn with a revision and lease before the queue sends it", async () => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  const job = { id: 1, business_id: "business-a", connection_id: "connection-a", participant_id: message.externalParticipantId, payload: message, status: "processing", lease_token: "lease-a", reply: null };
  await handleInboundMessage(message, job);
  expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_id: 1, p_token: "lease-a", p_revision: 0, p_conversation: "conversation-a" }));
  expect(writes.filter(w => w.table === "conversation_states" && w.operation === "upsert")).toEqual([]);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(job.status).toBe("prepared");
  expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ state: { ...migrateContext(emptyState()), recentMessages: [] }, bookingGuard: expect.objectContaining({ revision: 0, leaseToken: "lease-a" }) }));
});
it.each(["stale_state", "lease_lost"])("W2 refuses to overwrite corrected state when a concurrent turn returns %s", async error => {
  mocks.rpc.mockImplementation(async (name: string) => name === "bind_workflow_inbound" ? { data: true, error: null } : { error: { message: error } });
  const before = structuredClone(savedState);
  const job = queuedJob();
  await expect(handleInboundMessage({ ...message, text: "Po" }, job)).rejects.toThrow("State commit failed");
  expect(savedState).toEqual(before);
  expect(writes.filter(w => w.table === "conversation_states" && w.operation === "upsert")).toEqual([]);
  expect(mocks.send).not.toHaveBeenCalled(); expect(job.status).not.toBe("prepared");
});


it.each(["sent", "failed", "pending"])("passes only confirmed prompt delivery to the processor (%s)",async delivery_status=>{
 outboundResult={data:{body:"Ta konfirmojmë porosinë?",source:"agent",delivery_status},error:null};
 await handleInboundMessage({...message,text:"Po"},queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({deliveredReply:delivery_status==="sent"?"Ta konfirmojmë porosinë?":null}));
});
it("does not use a staff reply as approval of an older agent prompt",async()=>{
 outboundResult={data:{body:"Po",source:"staff",delivery_status:"sent"},error:null};
 await handleInboundMessage({...message,text:"Ok"},queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({deliveredReply:null}));
});
it.each(["staff", "uncertain"])("W1 invalidates a pending clarification after %s ownership/delivery evidence", async reason => {
  savedState = { ...emptyState(), schemaVersion: 3, conversationPaused: true,
    processes: { active: null, pendingClarification: { kind: "resume_process", target: null, expiresAt: Date.now() + 60000 } } };
  if (reason === "staff") outboundResult = { data: { body: "Stafi po ndihmon", source: "staff", delivery_status: "sent" }, error: null };
  else deliveryAttempt = { status: "uncertain", reply: "Sqarim" };
  await handleInboundMessage({ ...message, text: "kerkesen e meparshme" }, queuedJob());
  expect(mocks.process.mock.calls[0][0].state.processes.pendingClarification).toBeUndefined();
  expect(mocks.process.mock.calls[0][0].state.conversationPaused).toBe(true);
});
it("stops before the processor if delivery evidence cannot be read",async()=>{
 outboundResult={data:null,error:{message:"unavailable"}};
 await expect(handleInboundMessage({...message,text:"Po"},queuedJob())).rejects.toThrow("Conversation history unavailable");
 expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["sent", "uncertain", "prepared"])("checks the latest queue attempt even when an old identical reply was sent (%s)",async status=>{
 const body="Ta konfirmojmë porosinë?";
 outboundResult={data:{body,source:"agent",delivery_status:"sent"},error:null};
 deliveryAttempt={status,reply:body};
 await handleInboundMessage({...message,text:"Po"},queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({deliveredReply:status==="sent"?body:null}));
});

it.each(["new", "pilot", "migrated"])("requires the queue for live %s Instagram state even when routing can be tested without it", async kind => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", kind === "pilot" ? "business-a" : "");
  if (kind === "migrated") savedState.schemaVersion = 3;
  await expect(handleInboundMessage(message)).rejects.toThrow("workflow_queue_required");
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(writes.filter(w => w.table === "conversation_states")).toEqual([]);
});
it.each(["instagram", "whatsapp"] as const)("hydrates queued %s pilot state before passing it to the coordinator", async channel => {
  vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "business-a");
  const incoming = { ...message, channel, contextMetadata: channel === "whatsapp" ? { whatsappPhoneNumberId: "123456" } : message.contextMetadata };
  await handleInboundMessage(incoming, { ...queuedJob(), payload: incoming });
  expect(mocks.from).toHaveBeenCalledWith("conversation_profiles");
  expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ source: channel, state: expect.objectContaining({ context: expect.objectContaining({ profile: {} }) }) }));
  expect(mocks.rpc).toHaveBeenCalledWith("prepare_workflow_reply", expect.objectContaining({ p_revision: 0 }));
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.whatsappSend).not.toHaveBeenCalled();
});

it("persists every paused inbound without executing or sending, including queue batches", async () => {
  paused = true;
  const second = { ...message, externalMessageId: "paused-2", text: "Edhe një pyetje" };
  await handleInboundMessage(message, { ...queuedJob(), batch_payloads: [message, second] });
  const inbound = writes.filter(write => write.table === "messages" && (write.data as {direction:string}).direction === "inbound");
  expect(inbound.map(write => (write.data as {external_message_id:string}).external_message_id)).toEqual(["msg-a", "paused-2"]);
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalledWith("prepare_workflow_reply", expect.anything());
  expect(mocks.send).not.toHaveBeenCalled();
});
it("uses staff and paused customer history after reactivation without feeding it into fields", async () => {
  savedState = { ...emptyState(), staffHandoff: true, product_id: "product", fields: { size: "L" } };
  historyResult = { data: [
    { body: message.text, direction: "inbound", source: "customer", delivery_status: "delivered", external_message_id: message.externalMessageId },
    { body: "Mund të vazhdojmë porosinë", direction: "outbound", source: "staff", delivery_status: "sent", external_message_id: "staff-1" },
    { body: "Dua të ndryshoj adresën", direction: "inbound", source: "customer", delivery_status: "delivered", external_message_id: "paused-1" },
  ], error: null };
  await handleInboundMessage(message, queuedJob());
  expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ message: message.text, previousResponseId: null,
    state: expect.objectContaining({ conversationPaused: true, product_id: "product", fields: { size: "L" }, recentMessages: [
      { role: "user", content: "Dua të ndryshoj adresën" }, { role: "assistant", content: "[Stafi] Mund të vazhdojmë porosinë" },
    ] }) }));
  expect(mocks.process.mock.calls[0][0].state.staffHandoff).toBeUndefined();
  expect(savedState.staffHandoff).toBe(true);
});
it("does not generate an answer with missing inbox context when history read fails", async () => {
  historyResult = { data: [], error: { message: "unavailable" } };
  await expect(handleInboundMessage(message, queuedJob())).rejects.toThrow("Conversation history unavailable");
  expect(writes.some(write => write.table === "messages" && (write.data as {direction:string}).direction === "inbound")).toBe(true);
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("recognizes staff ownership even when its reply is outside the bounded recent history", async () => {
  const { migrateConversationProcesses } = await import("@/lib/workflows/conversation-processes");
  const { migrateContext } = await import("@/lib/workflows/context");
  savedState = migrateConversationProcesses(migrateContext({ ...emptyState(), product_id: "product", fields: { size: "L" }, step_key: "collect_customer" }), () => "saved-task");
  outboundResult = { data: { body: "Stafi ju përgjigjet", source: "staff", delivery_status: "sent" }, error: null };
  historyResult = { data: Array.from({length:10}, (_,i) => ({ body:`Pyetja ${i}`, source:"customer", direction:"inbound", delivery_status:"delivered", external_message_id:`paused-${i}` })), error:null };
  await handleInboundMessage(message, queuedJob());
  const params = mocks.process.mock.calls[0][0];
  expect(params.previousResponseId).toBeNull();
  expect(params.state).toMatchObject({ conversationPaused:true, processes:{active:null,promptOwner:null,order:{status:"suspended",snapshot:{product_id:"product",fields:{size:"L"}}}} });
});

it.each(["uncertain", "prepared", "sending"])("does not consume a field after an unconfirmed prompt (%s)", async status => {
 savedState = { ...emptyState(), product_id:"product", step_key:"collect_customer", fields:{ size:"L" } };
 deliveryAttempt = { status, reply:"Në cilin qytet?" };
 await handleInboundMessage({ ...message, text:"Tiranë" }, queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ previousResponseId:null, state:expect.objectContaining({ conversationPaused:true, fields:{size:"L"} }) }));
});
it.each(["staff", "unconfirmed"])("C2 revokes every process prompt at the %s inbound boundary", async boundary => {
 const visual = { versionId: "pinned", nodeId: "details", status: "waiting" as const, awaiting: true, visited: [], values: { note: "Keep" } };
 savedState = { ...emptyState(), schemaVersion: 3, processes: { active: null,
   service: { id: "service-task", status: "active", promptCurrent: true, versionId: "pinned", visual, fields: { note: "Keep" }, order: {} },
   actionFlow: { id: "admin-task", versionId: "pinned", visual, promptCurrent: true, fields: { private: "Keep" } },
 } };
 if (boundary === "staff") outboundResult = { data: { body: "Stafi ju përgjigjet", source: "staff", delivery_status: "sent" }, error: null };
 else deliveryAttempt = { status: "uncertain", reply: "Konfirmo" };
 await handleInboundMessage({ ...message, text: "po" }, queuedJob());
 const state = mocks.process.mock.calls[0][0].state;
 expect(state.conversationPaused).toBe(true);
 expect(state.processes.service).toMatchObject({ status: "suspended", promptCurrent: false, visual, fields: { note: "Keep" } });
 expect(state.processes.actionFlow).toMatchObject({ promptCurrent: false, visual, fields: { private: "Keep" } });
 expect(savedState.processes?.actionFlow?.promptCurrent).toBe(true);
});
it.each(["ignored", "failed", "sent"])("does not re-arm clarify after a settled queue attempt (%s)", async status => {
 savedState = { ...emptyState(), product_id:"product", step_key:"collect_customer", fields:{ size:"L" }, conversationPaused: false };
 deliveryAttempt = { status, reply:"Në cilin qytet?" };
 await handleInboundMessage({ ...message, text:"Tiranë" }, queuedJob());
 expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ state:expect.objectContaining({ conversationPaused: false, fields:{size:"L"} }) }));
});
it("does not treat the WhatsApp transport as a workflow channel field", async () => {
  const incoming = { ...message, channel: "whatsapp" as const, externalParticipantId: "355691234567", contextMetadata: { whatsappPhoneNumberId: "123456" } };
  await handleInboundMessage(incoming, { ...queuedJob(), participant_id: incoming.externalParticipantId, payload: incoming });
  expect(mocks.process.mock.calls[0][0].state.fields.channel).toBeUndefined();
});
