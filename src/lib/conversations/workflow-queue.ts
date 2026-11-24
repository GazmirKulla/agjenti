import { semanticConversationTitle } from "./semantic-title";
import { recordSystem } from "@/lib/tracking/system-events";
import { withAiUsage } from "@/lib/ai/usage";
import { createServiceSupabase } from "@/lib/supabase/service";
import { recordCapabilityEvents } from "@/lib/tracking/events";
import { decryptSecret } from "@/lib/crypto/tokens";
import { encryptSecret } from "@/lib/crypto/tokens";
import type { TestChatInput, TestChatResult } from "@/lib/agents/test-chat/types";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { isMetaDashboardTestMessage } from "@/lib/instagram/parse-webhook";
import { channelAdapter } from "./channel";
import { MAX_REPLY_PHOTOS, sendReplyWithPhotos } from "./reply-photos";
import { instagramReplyWindow, isInstagramMessagingWindowOpen } from "@/lib/instagram/window";
import { markInstagramTokenRejected } from "@/lib/instagram/token-health";
import type { AgentTurnResult } from "./process-agent-turn";
import { InboundPersistenceError } from "./inbound-persistence-error";
import { isIsolatedExecution, refuseIsolatedEffect } from "@/lib/runtime/execution-context";
import { fragmentKind, testInputBatch } from "./message-batch";
import { commitProcessCheckpoint } from "@/lib/orchestration/persistence";
export type WorkflowJob = {
    id: number;
    business_id: string;
    connection_id: string;
    participant_id: string;
    payload: NormalizedIncomingMessage;
    status: string;
    process_runtime?: boolean;
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
    /** Photos fixed for a prepared agent reply by attach_workflow_reply_media; sent after its text. */
    reply_media?: { kind: "image"; productId: string; url: string }[] | null;
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
    const payload = { ...message, fragmentKind: await withAiUsage(connection.business_id, () => fragmentKind(message.text, message.attachments.length > 0)) };
    const { error: insertError } = await db.from("workflow_inbound_queue").upsert({ business_id: connection.business_id, channel: message.channel, connection_id: connection.id, participant_id: message.externalParticipantId, external_id: message.externalMessageId, payload }, { onConflict: "connection_id,external_id", ignoreDuplicates: true });
    if (insertError)
        throw new Error("Queue persistence failed");
    return true;
}
export async function prepareWorkflowReply(job: WorkflowJob, conversationId: string, revision: number, turn: AgentTurnResult) {
    if (isIsolatedExecution()) refuseIsolatedEffect("background_job", "prepare_workflow_reply");
    if (turn.nextState.runtime) {
        const envelope = turn.processCheckpoint;
        const state = turn.nextState.runtime;
        if (!envelope || state.mode !== "live" || state.businessId !== job.business_id || state.conversationId !== conversationId
            || envelope.event.businessId !== job.business_id || envelope.event.conversationId !== conversationId
            || envelope.expectedRevision < revision || state.revision !== envelope.expectedRevision + 1) throw new Error("Invalid process delivery envelope");
        const receipt = await commitProcessCheckpoint({ event: envelope.event, expectedRevision: envelope.expectedRevision,
            transition: { state, notices: [], actions: [] }, lease: { jobId: job.id, leaseToken: job.lease_token },
            reply: { text: turn.reply, presentedTargetIds: envelope.targetIds } });
        // On replay the database's prepared text is authoritative, not regenerated prose.
        if (receipt.replayed) {
            const { data, error } = await createServiceSupabase().from("workflow_inbound_queue").select("reply,status,reply_media")
                .eq("id", job.id).eq("business_id", job.business_id).eq("lease_token", job.lease_token).maybeSingle();
            if (error || data?.status !== "prepared" || typeof data.reply !== "string") throw new Error("Process reply receipt unavailable");
            job.reply = data.reply;
            job.reply_media = replyMedia(data.reply_media);
        } else {
            // Committed just now (never on a replay): what this turn started and ended.
            await recordCapabilityEvents((turn.capabilityEvents ?? []).map(event => ({ ...event, businessId: job.business_id, mode: "live" as const })));
            job.reply = turn.reply;
            job.reply_media = turn.productPhotos?.length ? await attachReplyMedia(job, turn.productPhotos.map(photo => photo.productId)) : null;
        }
        job.conversation_id = conversationId;
        job.process_runtime = true;
        job.status = "prepared";
        return;
    }
    throw new Error("Native process checkpoint required");
}
/** Only well-formed photos fixed by the database are sent; anything else sends the reply as text. */
function replyMedia(value: unknown): WorkflowJob["reply_media"] {
    if (!Array.isArray(value) || !value.length || value.length > MAX_REPLY_PHOTOS) return null;
    const items = value.filter((item): item is { kind: "image"; productId: string; url: string } => Boolean(item) && typeof item === "object"
        && item.kind === "image" && typeof item.productId === "string" && typeof item.url === "string" && /^https:\/\/\S+$/.test(item.url));
    return items.length === value.length ? items : null;
}
/** The database re-reads each photo from the business's active products. Without its confirmation the reply goes as text. */
async function attachReplyMedia(job: WorkflowJob, productIds: string[]) {
    const { data, error } = await createServiceSupabase().rpc("attach_workflow_reply_media", {
        p_business: job.business_id, p_job: job.id, p_token: job.lease_token, p_products: productIds.slice(0, MAX_REPLY_PHOTOS),
    });
    return error ? null : replyMedia(data);
}
async function sendPrepared(job: WorkflowJob) {
    const db = createServiceSupabase();
    const adapter = channelAdapter(job.payload.channel);
    const { data: connection, error } = await db.from(adapter.table).select(job.payload.channel === "whatsapp" ? "phone_number_id,access_token_ciphertext,status" : "ig_user_id,access_token_ciphertext,status").eq("id", job.connection_id).eq("business_id", job.business_id).maybeSingle();
    if (error || !connection || connection.status !== "connected")
        throw new Error("Connection unavailable");
    const token = decryptSecret(connection.access_token_ciphertext);
    if (!job.process_runtime && job.operation_kind !== "staff") throw new Error("Legacy agent output cannot be delivered");
    const { data: claimed, error: claimError } = await db.rpc("begin_workflow_send", { p_id: job.id, p_token: job.lease_token });
    if (claimError)
        throw new Error("Send lease lost");
    if (!claimed) return; // A staff takeover can discard prepared output atomically.
    job.status = "sending";
    let humanAgent: { lastInboundAt: string } | undefined;
    if (job.operation_kind === "staff" && job.payload.channel === "instagram") {
        const { data: conversation, error: lookupError } = await db.from("conversations").select("last_inbound_at")
            .eq("id", job.conversation_id).eq("business_id", job.business_id).maybeSingle();
        if (lookupError || !conversation?.last_inbound_at) throw new Error("Conversation window unavailable");
        humanAgent = { lastInboundAt: conversation.last_inbound_at };
    }
    const allowed = humanAgent ? instagramReplyWindow(humanAgent.lastInboundAt) !== "closed"
        : isInstagramMessagingWindowOpen(job.payload.timestamp);
    // A staff photo (the business's processed design) goes as an image, with its caption.
    const media = job.operation_kind === "staff" ? (job.payload as { media?: { kind?: unknown; url?: unknown } }).media : undefined;
    const image = media?.kind === "image" && typeof media.url === "string" ? media.url : null;
    // Each part's receipt is persisted before the next provider request; a failed persistence stops the send.
    const onPart = async (part: import("./delivery-status").MessagePart, total: number) => {
        const receipt = { p_job: job.id, p_token: job.lease_token, p_index: part.index, p_total: total, p_body: part.body, p_status: part.status, p_external: part.messageId ?? null, p_error: part.error ?? null };
        for (let attempt = 0; attempt < 2; attempt++) {
            try { const { error } = await db.rpc("record_transport_part", receipt); if (!error) return; }
            catch { /* Retry the idempotent DB receipt, never the external part. */ }
        }
        throw new Error("Part receipt persistence failed; do not resend");
    };
    const target = { accountId: String("phone_number_id" in connection ? connection.phone_number_id : connection.ig_user_id), token: String(token), to: job.participant_id, onPart, ...(humanAgent ? { humanAgent } : {}) };
    const photos = job.operation_kind !== "staff" ? replyMedia(job.reply_media) : null;
    const sent = allowed
      ? await (image ? adapter.sendImage({ ...target, url: image, caption: job.reply })
        : photos ? sendReplyWithPhotos({ ...target, channel: job.payload.channel, body: job.reply ?? "", photos })
        : adapter.send({ ...target, body: job.reply ?? "" }))
      : { ok: false as const, error: "Dritarja 24-orëshe ka mbaruar." };
    const confirmed = sent.ok && typeof sent.messageId === "string" && Boolean(sent.messageId.trim());
    // Meta rejected the token: the connection stops showing as connected and the owner is asked to reconnect.
    const tokenRejected = !sent.ok && "code" in sent && sent.code === "token_revoked";
    if (tokenRejected && job.payload.channel !== "whatsapp")
        await markInstagramTokenRejected(db, { id: job.connection_id, businessId: job.business_id }, "send").catch(() => console.error("[workflow send] token state not saved"));
    const receipt = { p_id: job.id, p_token: job.lease_token, p_ok: confirmed,
        p_external: confirmed && sent.ok ? sent.messageId! : null,
        p_error: confirmed ? null : sent.ok ? "Provider receipt missing" : sent.error };
    // A lost database response may follow a committed receipt. Retry the
    // idempotent receipt transaction, never the provider request.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const { error: finishError } = await db.rpc("finish_workflow_send", receipt);
            if (!finishError) {
                // The customer's reply, once its receipt is stored. Staff messages are not the agent's.
                if (job.operation_kind !== "staff") await recordCapabilityEvents([{ businessId: job.business_id, capability: "customer.reply", mode: "live",
                    point: confirmed ? "sent" : "failed", reason: confirmed ? undefined : !allowed ? "window_closed" : sent.ok ? "receipt_missing" : tokenRejected ? "token_rejected" : "provider_error",
                    conversationId: job.conversation_id ?? undefined, ref: `job:${job.id}` }]);
                return;
            }
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
            await withAiUsage(job.business_id, async () => {
            if (job.operation_kind === "test") {
                if (!testScope || job.business_id !== testScope.businessId || job.operator_user_id !== testScope.userId || job.test_stream_id !== testScope.streamId) throw new Error("Test transport isolation violation");
                const { executeAgentTestTurn } = await import("@/lib/agents/test-chat/execute-turn");
                const { data: prior, error: priorError } = await db.from("workflow_inbound_queue").select("result_ciphertext,status,payload")
                  .eq("business_id", job.business_id).eq("operator_user_id", job.operator_user_id!).eq("test_stream_id", job.test_stream_id!)
                  .is("batch_parent_id", null).lt("id", job.id).order("id", { ascending: false }).limit(1).maybeSingle();
                if (priorError || prior && (prior.status !== "sent" || !prior.result_ciphertext)) throw new Error("Previous turn unavailable");
                const batch = testInputBatch({ ...job.payload } as unknown as TestChatInput, job);
                const input = batch.input;
                let previousTitle: string | undefined;
                let previousReply = "";
                if (prior) {
                    const previous = JSON.parse(decryptSecret(prior.result_ciphertext)) as TestChatResult;
                    if ("error" in previous) throw new Error("Previous turn failed");
                    input.session = previous.session;
                    previousTitle = previous.conversationTitle;
                    previousReply = previous.reply;
                }
                const result = await executeAgentTestTurn(input, job.operator_user_id!, batch.count);
                let generatedTitle: string | null = null;
                if (!("error" in result)) {
                  if (!previousTitle && result.turns <= 6) generatedTitle = await semanticConversationTitle(job.business_id, [
                    ...(prior?.payload?.message ? [{ role: "user", content: String(prior.payload.message) }, { role: "assistant", content: previousReply }] : []),
                    { role: "user", content: input.message }, { role: "assistant", content: result.reply },
                  ]);
                  if (previousTitle || generatedTitle) result.conversationTitle = previousTitle ?? generatedTitle!;
                }
                const { error } = await db.rpc("finish_test_transport", { p_id: job.id, p_token: job.lease_token, p_result: "error" in result && !result.labObservation ? null : encryptSecret(JSON.stringify(result)), p_error: "error" in result ? result.error : null });
                if (error) {
                  if (generatedTitle) await recordSystem("assistant.conversation_title", "failed", { businessId: job.business_id, reason: "storage:failed", ref: job.test_stream_id! });
                  throw new Error("Test result commit failed");
                }
                if (generatedTitle) await recordSystem("assistant.conversation_title", "stored", { businessId: job.business_id, ref: job.test_stream_id! });
                processed++;
                return;
            }
            let skipped: string | undefined;
            if (job.status !== "prepared") {
                const { handleInboundMessage } = await import("./handle-inbound");
                skipped = (await handleInboundMessage({ ...job.payload, timestamp: new Date(job.payload.timestamp) }, job))?.skipped;
            }
            if (job.status === "prepared")
                await sendPrepared(job);
            else
            {
                await db.from("workflow_inbound_queue").update({ status: "ignored", leased_until: null }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "processing").throwOnError();
                await recordCapabilityEvents([{ businessId: job.business_id, capability: "customer.reply", point: "ignored", reason: skipped ?? "no_reply_prepared", mode: "live", ref: `job:${job.id}` }]);
            }
            processed++;
            });
        }
        catch (error) {
            // Retain prepared output after a pre-send failure. A send with an unknown result is never replayed.
            const detail = error instanceof InboundPersistenceError ? error.message : "Workflow processing failed";
            await db.from("workflow_inbound_queue").update({ leased_until: new Date(Date.now() + 30000).toISOString(), error: detail }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", job.status).throwOnError();
            // Each failed attempt is counted; the job is retried and may still be sent.
            if (job.operation_kind !== "staff") await recordCapabilityEvents([{ businessId: job.business_id, capability: "customer.reply", point: "attempt_failed", mode: "live",
                reason: error instanceof InboundPersistenceError ? "persistence_failed" : job.status === "prepared" ? "send_failed" : "turn_failed", ref: `job:${job.id}` }]);
        }
    }
    return processed;
}
