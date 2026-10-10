import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { sharedWorkflowEnabled } from "@/lib/workflows/context";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import { isMetaDashboardTestMessage } from "@/lib/instagram/parse-webhook";
import { sendInstagramText } from "@/lib/instagram/send";
import type { AgentTurnResult } from "./process-agent-turn";
export type WorkflowJob = {
    id: number;
    business_id: string;
    connection_id: string;
    participant_id: string;
    payload: NormalizedIncomingMessage;
    status: string;
    lease_token: string;
    reply: string | null;
};
export async function enqueueWorkflowMessage(message: NormalizedIncomingMessage) {
    if (!process.env.SHARED_WORKFLOW_BUSINESS_IDS?.trim() || isMetaDashboardTestMessage(message))
        return false;
    const db = createServiceSupabase();
    const { data: connection, error } = await db.from("instagram_connections").select("id,business_id").eq("ig_user_id", message.contextMetadata?.instagramAccountId).neq("status", "disconnected").maybeSingle();
    if (error)
        throw new Error("Queue connection lookup failed");
    if (!connection || !sharedWorkflowEnabled(connection.business_id))
        return false;
    const { error: insertError } = await db.from("workflow_inbound_queue").upsert({ business_id: connection.business_id, connection_id: connection.id, participant_id: message.externalParticipantId, external_id: message.externalMessageId, payload: message }, { onConflict: "connection_id,external_id", ignoreDuplicates: true });
    if (insertError)
        throw new Error("Queue persistence failed");
    return true;
}
export async function prepareWorkflowReply(job: WorkflowJob, conversationId: string, revision: number, turn: AgentTurnResult) {
    const { error } = await createServiceSupabase().rpc("prepare_workflow_reply", { p_id: job.id, p_token: job.lease_token, p_conversation: conversationId, p_revision: revision, p_state: turn.nextState, p_workflow: turn.workflowId, p_reply: turn.reply, p_response: turn.previousResponseId, p_handoff: Boolean(turn.handoff && !turn.advisoryHandoff) });
    if (error)
        throw new Error("State commit failed");
    job.reply = turn.reply;
    job.status = "prepared";
}
async function sendPrepared(job: WorkflowJob) {
    const db = createServiceSupabase();
    const { data: connection, error } = await db.from("instagram_connections").select("ig_user_id,access_token_ciphertext,status").eq("id", job.connection_id).eq("business_id", job.business_id).maybeSingle();
    if (error || !connection || connection.status !== "connected")
        throw new Error("Connection unavailable");
    const token = decryptSecret(connection.access_token_ciphertext);
    const { data: claimed, error: claimError } = await db.rpc("begin_workflow_send", { p_id: job.id, p_token: job.lease_token });
    if (claimError || !claimed)
        throw new Error("Send lease lost");
    job.status = "sending";
    const sent = await sendInstagramText({ accountId: connection.ig_user_id, token, to: job.participant_id, body: job.reply ?? "" });
    const { error: finishError } = await db.rpc("finish_workflow_send", { p_id: job.id, p_token: job.lease_token, p_ok: sent.ok, p_external: sent.ok ? sent.messageId ?? null : null, p_error: sent.ok ? null : sent.error });
    if (finishError)
        throw new Error("Send receipt unavailable");
}
export async function runWorkflowQueue(maxJobs = 10) {
    const businesses = (process.env.SHARED_WORKFLOW_BUSINESS_IDS ?? "").split(",").map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s));
    if (!businesses.length)
        return 0;
    const db = createServiceSupabase();
    let processed = 0;
    const started = Date.now();
    for (let i = 0; i < maxJobs && Date.now() - started < 45000; i++) {
        const { data, error } = await db.rpc("claim_workflow_inbound", { p_businesses: businesses });
        if (error)
            throw new Error("Queue claim failed");
        const job = data?.[0] as WorkflowJob | undefined;
        if (!job)
            break;
        try {
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
        catch {
            // Retain prepared output after a pre-send failure. A send with an unknown result is never replayed.
            await db.from("workflow_inbound_queue").update({ leased_until: new Date(Date.now() + 30000).toISOString(), error: "Workflow processing failed" }).eq("id", job.id).eq("lease_token", job.lease_token).throwOnError();
        }
    }
    return processed;
}
