import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { encryptSecret } from "@/lib/crypto/tokens";
import type { TestChatInput, TestChatResult } from "@/lib/agents/test-chat/execute-turn";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { isMetaDashboardTestMessage } from "@/lib/instagram/parse-webhook";
import { channelAdapter } from "./channel";
import { isInstagramMessagingWindowOpen } from "@/lib/instagram/window";
import type { AgentTurnResult } from "./process-agent-turn";
import { InboundPersistenceError } from "./inbound-persistence-error";
import { isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { fragmentKind, testInputBatch } from "./message-batch";
export type WorkflowJob = {
    id: number;
    business_id: string;
    connection_id: string;
    participant_id: string;
    payload: NormalizedIncomingMessage;
    status: string;
    attempts?: number;
    client_sequence?: number;
    client_request_id?: string;
    lease_token: string;
    reply: string | null;
    conversation_id?: string | null;
    batch_payloads?: NormalizedIncomingMessage[] | null;
    operation_kind?: "inbound" | "staff" | "test";
    operator_user_id?: string;
    test_stream_id?: string;
};
export async function enqueueWorkflowMessage(message: NormalizedIncomingMessage) {
    if (isIsolatedExecution()) refuseIsolatedEffect("background_job", "workflow_queue");
    if (isMetaDashboardTestMessage(message))
        return false;
    const db = createServiceSupabase();
    const adapter = channelAdapter(message.channel);
    const { data: connection, error } = await db.from(adapter.table).select("id,business_id").eq(adapter.account, message.contextMetadata?.[adapter.metadata]).eq("status", "connected").maybeSingle();
    if (error)
        throw new Error("Queue connection lookup failed");
    if (!connection)
        return false;
    const payload = { ...message, fragmentKind: fragmentKind(message.text, message.attachments.length > 0) };
    const { error: insertError } = await db.from("workflow_inbound_queue").upsert({ business_id: connection.business_id, channel: message.channel, connection_id: connection.id, participant_id: message.externalParticipantId, external_id: message.externalMessageId, payload }, { onConflict: "connection_id,external_id", ignoreDuplicates: true });
    if (insertError)
        throw new Error("Queue persistence failed");
    return true;
}
export async function prepareWorkflowReply(job: WorkflowJob, conversationId: string, revision: number, turn: AgentTurnResult) {
    if (isIsolatedExecution()) refuseIsolatedEffect("background_job", "prepare_workflow_reply");
    const { error } = await createServiceSupabase().rpc("prepare_workflow_reply", { p_id: job.id, p_token: job.lease_token, p_conversation: conversationId, p_revision: revision, p_state: turn.nextState, p_workflow: turn.workflowId, p_reply: turn.reply, p_response: turn.previousResponseId, p_handoff: Boolean(turn.handoff && !turn.advisoryHandoff) });
    if (error)
        throw new Error("State commit failed");
    job.reply = turn.reply;
    job.status = "prepared";
}
async function sendPrepared(job: WorkflowJob) {
    const db = createServiceSupabase();
    const adapter = channelAdapter(job.payload.channel);
    const { data: connection, error } = await db.from(adapter.table).select(job.payload.channel === "whatsapp" ? "phone_number_id,access_token_ciphertext,status" : "ig_user_id,access_token_ciphertext,status").eq("id", job.connection_id).eq("business_id", job.business_id).maybeSingle();
    if (error || !connection || connection.status !== "connected")
        throw new Error("Connection unavailable");
    const token = decryptSecret(connection.access_token_ciphertext);
    const { data: claimed, error: claimError } = await db.rpc("begin_workflow_send", { p_id: job.id, p_token: job.lease_token });
    if (claimError)
        throw new Error("Send lease lost");
    if (!claimed) return; // A staff takeover can discard prepared output atomically.
    job.status = "sending";
    const sent = job.payload.channel !== "whatsapp" || isInstagramMessagingWindowOpen(new Date(job.payload.timestamp).toISOString())
      ? await adapter.send({ accountId: String("phone_number_id" in connection ? connection.phone_number_id : connection.ig_user_id), token: String(token), to: job.participant_id, body: job.reply ?? "",
          onPart: async (part, total) => {
            const receipt = { p_job: job.id, p_token: job.lease_token, p_index: part.index, p_total: total, p_body: part.body, p_status: part.status, p_external: part.messageId ?? null, p_error: part.error ?? null };
            for (let attempt = 0; attempt < 2; attempt++) {
                try { const { error } = await db.rpc("record_transport_part", receipt); if (!error) return; }
                catch { /* Retry the idempotent DB receipt, never the external part. */ }
            }
            throw new Error("Part receipt persistence failed; do not resend");
          } })
      : { ok: false as const, error: "Dritarja 24-orëshe ka mbaruar." };
    const confirmed = sent.ok && typeof sent.messageId === "string" && Boolean(sent.messageId.trim());
    const receipt = { p_id: job.id, p_token: job.lease_token, p_ok: confirmed,
        p_external: confirmed && sent.ok ? sent.messageId! : null,
        p_error: confirmed ? null : sent.ok ? "Provider receipt missing" : sent.error };
    // A lost database response may follow a committed receipt. Retry the
    // idempotent receipt transaction, never the provider request.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const { error: finishError } = await db.rpc("finish_workflow_send", receipt);
            if (!finishError) return;
        } catch { /* Retry receipt persistence only; sending is never replayed. */ }
    }
    throw new Error("Send receipt unavailable");
}
export async function runWorkflowQueue(maxJobs = 10, testScope?: { businessId: string; userId: string; streamId: string }) {
    const db = createServiceSupabase();
    let processed = 0;
    const started = Date.now();
    let attempts = 0;
    while (attempts < maxJobs && Date.now() - started < 45000) {
        // Transport safety applies to every tenant, independently of workflow rollout.
        // Explicit protocol opt-in: old deployments must not consume new batches.
        // No fallback to the legacy claim if SQL has not been deployed yet.
        const { data, error } = await db.rpc("claim_workflow_transport", {
            p_businesses: testScope ? [testScope.businessId] : null,
            p_test_user: testScope?.userId ?? null, p_test_stream: testScope?.streamId ?? null,
            p_fragments: true,
        });
        if (error)
            throw new Error("Queue claim failed");
        const job = data?.[0] as WorkflowJob | undefined;
        if (!job) {
            const { data: delay, error: waitError } = testScope ? await db.rpc("workflow_fragment_wait_ms", {
                p_businesses: testScope ? [testScope.businessId] : null,
                p_test_user: testScope?.userId ?? null, p_test_stream: testScope?.streamId ?? null,
            }) : await db.rpc("workflow_inbound_batch_wait_ms");
            if (waitError) throw new Error("Queue wakeup lookup failed");
            if (typeof delay !== "number" || delay <= 0) break;
            const wait = Math.min(delay, 3000);
            if (Date.now() - started + wait >= 45000) break;
            await new Promise(resolve => setTimeout(resolve, wait));
            continue;
        }
        attempts++;
        try {
            if (job.operation_kind === "test") {
                if (!testScope || job.business_id !== testScope.businessId || job.operator_user_id !== testScope.userId || job.test_stream_id !== testScope.streamId) throw new Error("Test transport isolation violation");
                const { executeAgentTestTurn } = await import("@/lib/agents/test-chat/execute-turn");
                const { data: prior, error: priorError } = await db.from("workflow_inbound_queue").select("result_ciphertext,status")
                  .eq("business_id", job.business_id).eq("operator_user_id", job.operator_user_id!).eq("test_stream_id", job.test_stream_id!)
                  .is("batch_parent_id", null).lt("id", job.id).order("id", { ascending: false }).limit(1).maybeSingle();
                if (priorError || prior && (prior.status !== "sent" || !prior.result_ciphertext)) throw new Error("Previous turn unavailable");
                const batch = testInputBatch({ ...job.payload } as unknown as TestChatInput, job);
                const input = batch.input;
                if (prior) {
                    const previous = JSON.parse(decryptSecret(prior.result_ciphertext)) as TestChatResult;
                    if ("error" in previous) throw new Error("Previous turn failed");
                    input.session = previous.session;
                }
                const result = await executeAgentTestTurn(input, job.operator_user_id!, batch.count);
                const { error } = await db.rpc("finish_test_transport", { p_id: job.id, p_token: job.lease_token, p_result: "error" in result ? null : encryptSecret(JSON.stringify(result)), p_error: "error" in result ? result.error : null });
                if (error) throw new Error("Test result commit failed");
                processed++;
                continue;
            }
            if (job.status !== "prepared") {
                const { handleInboundMessage } = await import("./handle-inbound");
                await handleInboundMessage({ ...job.payload, timestamp: new Date(job.payload.timestamp) }, job);
            }
            if (job.status === "prepared")
                await sendPrepared(job);
            else
                await db.from("workflow_inbound_queue").update({ status: "ignored", leased_until: null }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "processing").throwOnError();
            processed++;
        }
        catch (error) {
            // Retain prepared output after a pre-send failure. A send with an unknown result is never replayed.
            const detail = error instanceof InboundPersistenceError ? error.message : "Workflow processing failed";
            await db.from("workflow_inbound_queue").update({ leased_until: new Date(Date.now() + 30000).toISOString(), error: detail }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", job.status).throwOnError();
        }
    }
    return processed;
}
