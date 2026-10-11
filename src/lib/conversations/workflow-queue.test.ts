import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), handle: vi.fn(), send: vi.fn(), writes: [] as unknown[], filters: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("./handle-inbound", () => ({ handleInboundMessage: m.handle }));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: m.send }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "test-token" }));
import { runWorkflowQueue, prepareWorkflowReply, enqueueWorkflowMessage } from "./workflow-queue";
import type { AgentTurnResult } from "./process-agent-turn";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { InboundPersistenceError } from "./inbound-persistence-error";
const business = "00000000-0000-4000-8000-000000004101";
const job = { id: 1, business_id: business, connection_id: "connection", participant_id: "person", lease_token: "lease", reply: "Saved answer", status: "prepared", payload: { timestamp: "2026-10-10T10:00:00Z" } };
beforeEach(() => {
    vi.clearAllMocks();
    m.writes = [];
    m.filters = [];
    vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", business);
    const chain = { select: () => chain, eq: (...v: unknown[]) => { m.filters.push(v); return chain; }, neq: () => chain, maybeSingle: async () => ({ data: { id: "connection", business_id: business, ig_user_id: "account", access_token_ciphertext: "sealed", status: "connected" }, error: null }), upsert: (...v: unknown[]) => { m.writes.push(v); return chain; }, update: (v: unknown) => { m.writes.push(v); return chain; }, throwOnError: async () => ({ error: null }), then: (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f) };
    m.from.mockReturnValue(chain);
    m.send.mockResolvedValue({ ok: true, messageId: "sent" });
    m.handle.mockReset();
    m.rpc.mockReset();
    m.rpc.mockResolvedValue({ data: 0, error: null });
});
it("sends persisted replies after recovery without regenerating or advancing state", async () => {
    m.rpc.mockResolvedValueOnce({ data: [structuredClone(job)], error: null }).mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await runWorkflowQueue()).toBe(1);
    expect(m.handle).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ body: "Saved answer" }));
    expect(m.rpc).toHaveBeenCalledWith("finish_workflow_send", expect.objectContaining({ p_ok: true, p_external: "sent" }));
});
it("never sends when another worker owns the lease", async () => {
    m.rpc.mockResolvedValueOnce({ data: [structuredClone(job)], error: null }).mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: [], error: null });
    await runWorkflowQueue();
    expect(m.send).not.toHaveBeenCalled();
});
it("pauses ambiguous delivery via the atomic completion RPC instead of resending", async () => {
    m.send.mockResolvedValue({ ok: false, error: "timeout" });
    m.rpc.mockResolvedValueOnce({ data: [structuredClone(job)], error: null }).mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: [], error: null });
    await runWorkflowQueue();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("finish_workflow_send", expect.objectContaining({ p_ok: false, p_error: "timeout" }));
});
it("does not expose a reply as prepared if the atomic commit fails", async () => {
    const queued = { ...job, status: "processing", payload: job.payload as unknown as NormalizedIncomingMessage };
    m.rpc.mockResolvedValue({ error: { message: "stale_state" } });
    await expect(prepareWorkflowReply(queued, "conversation", 4, { nextState: {}, reply: "Answer" } as AgentTurnResult)).rejects.toThrow();
    expect(queued.status).toBe("processing");
});
it("persists inbound events with idempotency before processing", async () => {
    vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
    const message = { channel: "instagram", externalMessageId: "event", externalParticipantId: "person", contextMetadata: { instagramAccountId: "account" }, timestamp: new Date(), rawPayload: {}, attachments: [] } as unknown as NormalizedIncomingMessage;
    expect(await enqueueWorkflowMessage(message)).toBe(true);
    expect(m.writes).toContainEqual([expect.objectContaining({ participant_id: "person", external_id: "event", business_id: business }), { onConflict: "connection_id,external_id", ignoreDuplicates: true }]);
});
it("claims every tenant independently of the shared workflow pilot", async () => {
    vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
    m.rpc.mockResolvedValue({ data: [], error: null });
    await runWorkflowQueue();
    expect(m.rpc).toHaveBeenCalledWith("claim_workflow_inbound_batch", { p_businesses: null });
});

it.each([true,false])("pauses only actual staff ownership, advisory=%s",async advisoryHandoff=>{
 m.rpc.mockResolvedValue({error:null});
 const queued={...job,status:"processing",payload:job.payload as unknown as NormalizedIncomingMessage};
 await prepareWorkflowReply(queued,"conversation",0,{nextState:{},reply:"Reply",handoff:true,advisoryHandoff} as AgentTurnResult);
 expect(m.rpc).toHaveBeenCalledWith("prepare_workflow_reply",expect.objectContaining({p_handoff:!advisoryHandoff}));
});

it("queues WhatsApp durably even outside the Instagram pilot", async () => {
 vi.stubEnv("SHARED_WORKFLOW_BUSINESS_IDS", "");
 const message = { channel: "whatsapp", externalMessageId: "wamid.1", externalParticipantId: "355691234567", contextMetadata: { whatsappPhoneNumberId: "123456" }, timestamp: new Date(), rawPayload: {}, attachments: [] } as unknown as NormalizedIncomingMessage;
 expect(await enqueueWorkflowMessage(message)).toBe(true);
 expect(m.from).toHaveBeenCalledWith("whatsapp_connections");
 expect(m.filters).toContainEqual(["phone_number_id", "123456"]);
 expect(m.writes).toContainEqual([expect.objectContaining({ channel: "whatsapp", connection_id: "connection" }), expect.objectContaining({ ignoreDuplicates: true })]);
});
it("does not send a WhatsApp reply after the customer service window expires", async () => {
 const expired = { ...structuredClone(job), payload: { channel: "whatsapp", timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } };
 m.rpc.mockResolvedValueOnce({ data: [expired], error: null }).mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: [], error: null });
 await runWorkflowQueue();
 expect(m.send).not.toHaveBeenCalled();
 expect(m.rpc).toHaveBeenCalledWith("finish_workflow_send", expect.objectContaining({ p_ok: false, p_error: "Dritarja 24-orëshe ka mbaruar." }));
});

it("retains a failed inbound for retry, then sends only after recovery prepares it", async () => {
 const processing = { ...structuredClone(job), status: "processing", reply: null };
 const failure = new InboundPersistenceError("workflow-job:1", "message_insert", "57014");
 m.handle.mockRejectedValueOnce(failure);
 m.rpc.mockResolvedValueOnce({ data: [processing], error: null }).mockResolvedValueOnce({ data: [], error: null });
 const before = Date.now();
 expect(await runWorkflowQueue()).toBe(0);
 expect(m.send).not.toHaveBeenCalled();
 expect(m.rpc).not.toHaveBeenCalledWith("begin_workflow_send", expect.anything());
 expect(m.writes).toEqual([expect.objectContaining({ error: failure.message, leased_until: expect.any(String) })]);
 expect(Date.parse((m.writes[0] as { leased_until: string }).leased_until)).toBeGreaterThanOrEqual(before + 30000);
 expect(processing.status).toBe("processing");

 // The database reclaims the same persisted job with a new lease after backoff.
 const recovered = { ...processing, lease_token: "new-lease" };
 m.handle.mockImplementationOnce(async (_message, claimed) => { claimed.status = "prepared"; claimed.reply = "Saved after retry"; });
 m.rpc.mockResolvedValueOnce({ data: [recovered], error: null })
   .mockResolvedValueOnce({ data: true, error: null })
   .mockResolvedValueOnce({ data: null, error: null })
   .mockResolvedValueOnce({ data: [], error: null });
 expect(await runWorkflowQueue()).toBe(1);
 expect(m.send).toHaveBeenCalledOnce();
 expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ body: "Saved after retry" }));
 expect(m.rpc).toHaveBeenCalledWith("finish_workflow_send", expect.objectContaining({ p_token: "new-lease", p_ok: true }));
});

it("does not persist arbitrary exception details in queue diagnostics", async () => {
 m.handle.mockRejectedValueOnce(new Error("private credential"));
 m.rpc.mockResolvedValueOnce({ data: [{ ...job, status: "processing" }], error: null }).mockResolvedValueOnce({ data: [], error: null });
 await runWorkflowQueue();
 expect(m.writes).toContainEqual(expect.objectContaining({ error: "Workflow processing failed" }));
 expect(JSON.stringify(m.writes)).not.toContain("private credential");
 expect(m.send).not.toHaveBeenCalled();
});

it("wakes after the quiet interval without consuming the job budget or replying early", async () => {
 vi.useFakeTimers();
 try {
  m.rpc.mockResolvedValueOnce({ data: [], error: null })
   .mockResolvedValueOnce({ data: 3000, error: null })
   .mockResolvedValueOnce({ data: [{ ...job, status: "processing" }], error: null })
   .mockResolvedValueOnce({ data: true, error: null })
   .mockResolvedValueOnce({ data: null, error: null });
  m.handle.mockImplementationOnce(async (_message, claimed) => { claimed.status = "prepared"; });
  const running = runWorkflowQueue(1);
  await vi.advanceTimersByTimeAsync(2999);
  expect(m.handle).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await running).toBe(1);
  expect(m.handle).toHaveBeenCalledOnce();
  expect(m.send).toHaveBeenCalledOnce();
 } finally { vi.useRealTimers(); }
});
