import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), handle: vi.fn(), send: vi.fn(), writes: [] as unknown[], filters: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("./handle-inbound", () => ({ handleInboundMessage: m.handle }));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: m.send }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "test-token" }));
import { runWorkflowQueue, prepareWorkflowReply, enqueueWorkflowMessage } from "./workflow-queue";
import type { AgentTurnResult } from "./process-agent-turn";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
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
    const message = { channel: "instagram", externalMessageId: "event", externalParticipantId: "person", contextMetadata: { instagramAccountId: "account" }, timestamp: new Date(), rawPayload: {}, attachments: [] } as unknown as NormalizedIncomingMessage;
    expect(await enqueueWorkflowMessage(message)).toBe(true);
    expect(m.writes).toContainEqual([expect.objectContaining({ participant_id: "person", external_id: "event", business_id: business }), { onConflict: "connection_id,external_id", ignoreDuplicates: true }]);
});
