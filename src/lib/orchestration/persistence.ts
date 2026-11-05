import { createServiceSupabase } from "@/lib/supabase/service";
import { type CustomerEvent, type RuntimeEvent, type Snapshot, type Transition } from "./contracts";
import { digest } from "./definition";
import { type ExecutionStore } from "./execute";

export type ProcessLease = { jobId: number; leaseToken: string };

/** Commit only server-validated transitions. One authoritative snapshot and the existing outbox. */
export async function commitProcessCheckpoint(input: {
  event: CustomerEvent | RuntimeEvent;
  expectedRevision: number;
  transition: Transition;
  lease: ProcessLease;
  reply?: { text: string; presentedTargetIds: string[] };
}): Promise<{ replayed: boolean; state: Snapshot; revision: number }> {
  const { data, error } = await createServiceSupabase().rpc("commit_process_checkpoint", {
    p_business: input.event.businessId,
    p_conversation: input.event.conversationId,
    p_job: input.lease.jobId,
    p_token: input.lease.leaseToken,
    p_event: input.event.id,
    p_event_hash: digest(input.event),
    p_revision: input.expectedRevision,
    p_state: input.transition.state,
    p_reply: input.reply?.text ?? null,
    p_targets: input.reply?.presentedTargetIds ?? [],
  });
  if (error) throw new Error(`process_checkpoint_failed:${error.code ?? "unknown"}`, { cause: error });
  if (!data || typeof data.replayed !== "boolean" || !data.state || data.state.schemaVersion !== 4
    || data.state.businessId !== input.event.businessId || data.state.conversationId !== input.event.conversationId
    || data.revision !== data.state.revision) throw new Error("invalid_checkpoint_receipt");
  return data;
}

/** Call after the transport's durable sent receipt, including after retrying receipt persistence. */
export async function persistProcessPresentation(businessId: string, lease: ProcessLease): Promise<void> {
  const { error } = await createServiceSupabase().rpc("record_process_presentation", {
    p_business: businessId, p_job: lease.jobId, p_token: lease.leaseToken,
  });
  if (error) throw new Error(`process_presentation_failed:${error.code ?? "unknown"}`, { cause: error });
}

/** Uses the same checkpoint transaction for dispatch claims and effect receipts. */
export function processExecutionStore(scope: { businessId: string; conversationId: string; lease: ProcessLease }): ExecutionStore {
  return {
    async claim(state, expectedRevision, actionId) {
      const instance = Object.values(state.instances).find(i => i.action?.id === actionId);
      if (!instance?.action || instance.action.status !== "running") throw new Error("invalid_dispatch_checkpoint");
      return commitProcessCheckpoint({ event: { id: `action:${actionId}:dispatch`, businessId: scope.businessId, conversationId: scope.conversationId,
        actor: "runtime", kind: "action_dispatch", actionId, inputDigest: instance.action.inputDigest },
        expectedRevision, transition: { state, notices: [], actions: [] }, lease: scope.lease });
    },
    async finish(transition, expectedRevision, receipt) {
      await commitProcessCheckpoint({ event: { id: `action:${receipt.actionId}:result:${receipt.status}`, businessId: scope.businessId, conversationId: scope.conversationId,
        actor: "runtime", kind: "action_result", actionId: receipt.actionId, inputDigest: receipt.inputDigest, result: { status: receipt.status, output: receipt.output } },
        expectedRevision, transition, lease: scope.lease });
    },
  };
}
