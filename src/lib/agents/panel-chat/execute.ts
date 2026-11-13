import { observeLabTurn } from "@/lib/chat-lab/observation";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret } from "@/lib/crypto/tokens";
import { readStoredConversationState } from "@/lib/orchestration/stored-state";
import { digest } from "@/lib/orchestration/definition";
import { processConversationMessage } from "@/lib/conversations/process-conversation-message";
import type { TestChatResult } from "../test-chat/types";
export type PanelScope = { businessId: string; userId: string; streamId: string };
/** Same coordinator and effect guards as inbound. No browser checkpoints or Meta sends. */
export async function runPanelChat(scope: PanelScope) {
  const db = createServiceSupabase();
  const started = Date.now();
  for (let count = 0; count < 10 && Date.now() - started < 45000; count++) {
    const { data, error } = await db.rpc("claim_panel_chat", { p_business: scope.businessId, p_user: scope.userId, p_stream: scope.streamId });
    if (error) throw new Error("Real chat queue unavailable");
    const job = data?.[0];
    if (!job) return;
    try {
      if (job.operation_kind !== "panel" || job.business_id !== scope.businessId || job.operator_user_id !== scope.userId || job.test_stream_id !== scope.streamId) throw new Error("Panel identity mismatch");
      const [conversation, saved, outbound] = await Promise.all([
        db.from("conversations").select("id,status,auto_reply,openai_previous_response_id,participant_username").eq("id", job.conversation_id).eq("business_id", scope.businessId).eq("panel_user_id", scope.userId).eq("panel_stream_id", scope.streamId).eq("channel", "panel").single(),
        db.from("conversation_states").select("collected,revision,workflow_id").eq("conversation_id", job.conversation_id).eq("business_id", scope.businessId).single(),
        db.from("workflow_inbound_queue").select("reply").eq("conversation_id", job.conversation_id).eq("business_id", scope.businessId).eq("operation_kind", "panel").eq("status", "sent").order("client_sequence", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (conversation.error || saved.error || outbound.error || conversation.data.status !== "active" || !conversation.data.auto_reply) throw new Error("Panel conversation unavailable");
      const canAct = async () => {
        const [access, owner] = await Promise.all([
          db.rpc("can_use_panel_chat", { p_business: scope.businessId, p_user: scope.userId }),
          db.from("conversations").select("status,auto_reply").eq("id", job.conversation_id).eq("business_id", scope.businessId).single(),
        ]);
        return !access.error && access.data === true && !owner.error && owner.data?.status === "active" && owner.data.auto_reply === true;
      };
      const state = readStoredConversationState(saved.data.collected, { businessId: scope.businessId, conversationId: job.conversation_id, revision: saved.data.revision });
      const observation = observeLabTurn(await isPlatformAdmin(scope.userId));
      const turn = await processConversationMessage({
        onTrace: observation.onTrace,
        mode: "production", source: "panel", businessId: scope.businessId,
        // The Instagram account given in Inputs is read like the account a prospect named.
        prospectSender: conversation.data.participant_username,
        message: job.payload.message, hasPhoto: false,
        state,
        persistedWorkflowId: saved.data.workflow_id,
        previousResponseId: conversation.data.openai_previous_response_id,
        deliveredReply: outbound.data?.reply ?? null, conversationKey: job.conversation_id,
        bookingGuard: { jobId: job.id, leaseToken: job.lease_token, conversationId: job.conversation_id, revision: saved.data.revision }, canAct,
        processTransport: { jobId: job.id, leaseToken: job.lease_token, conversationId: job.conversation_id, revision: saved.data.revision },
      });
      const result: TestChatResult = { ...turn, labObservation: observation.finish(), session: "", turns: job.client_sequence + 1, autoReplyEnabled: true };
      if (turn.nextState.runtime) {
        const checkpoint = turn.processCheckpoint;
        const snapshot = turn.nextState.runtime;
        if (!checkpoint || snapshot.mode !== "live" || snapshot.businessId !== scope.businessId || snapshot.conversationId !== job.conversation_id
          || checkpoint.event.businessId !== scope.businessId || checkpoint.event.conversationId !== job.conversation_id
          || checkpoint.expectedRevision !== snapshot.revision - 1) throw new Error("Invalid panel process checkpoint");
        const committed = await db.rpc("finish_process_panel_chat", { p_id: job.id, p_token: job.lease_token,
          p_revision: checkpoint.expectedRevision, p_state: snapshot, p_event: checkpoint.event.id, p_event_hash: digest(checkpoint.event),
          p_reply: turn.reply, p_targets: checkpoint.targetIds, p_result: encryptSecret(JSON.stringify(result)),
          p_handoff: Boolean(turn.handoff && !turn.advisoryHandoff) });
        if (committed.error) throw new Error("Panel process result commit failed");
        continue;
      }
      throw new Error("Native panel checkpoint required");
    } catch {
      // Retry the same job with a fresh lease. Workflow action keys remain stable
      // if an effect committed before the transcript receipt was lost.
      await db.from("workflow_inbound_queue").update({ leased_until: new Date(Date.now() + 30000).toISOString(), error: "Përpunimi nuk u konfirmua. Po kontrollojmë të njëjtën kërkesë." })
        .eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "processing").throwOnError();
      return;
    }
  }
}
