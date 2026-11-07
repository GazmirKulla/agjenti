import { createServiceSupabase } from "@/lib/supabase/service";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { loadProcessVersion, compileProcessVersion } from "./version-store";
import { TransitionError, type Instance } from "./contracts";
import { digest } from "./definition";
import { readOrderTerms } from "./order-context";
import type { ToolAdapter, EffectResult } from "./execute";
import type { ProcessLease } from "./persistence";
export function orderAdapter(scope?: { businessId: string; conversationId: string; lease: ProcessLease; instance: (id: string) => Instance | undefined }): ToolAdapter {
  return { key: "order.create", version: 1,
    async execute(action, context): Promise<EffectResult> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) throw new TransitionError("effect_scope_mismatch");
      const instance = scope.instance(action.instanceId);
      if (!instance || typeof action.input.productId !== "string") return { status: "failed", output: { code: "invalid_order_scope" } };
      try {
        const version = await loadProcessVersion(scope.businessId, instance.versionId);
        const definition = version && compileProcessVersion(version).find(d => d.id === instance.definitionId);
        const step = definition?.steps.find(s => s.id === action.stepId);
        if (!definition || definition.collection || definition.policyKey !== instance.policyKey || step?.kind !== "effect" || step.tool !== "order.create") return { status: "failed", output: { code: "order_definition_unavailable" } };
        const flow = version?.graph.version === 2 ? version.graph.flows.find(f => f.id === instance.definitionId) : undefined;
        if (flow?.productIds?.length && !flow.productIds.includes(action.input.productId)) return { status: "failed", output: { code: "product_outside_workflow" } };
        const current = await readOrderTerms(scope.businessId, action.input.productId);
        if (digest(current) !== digest(Object.fromEntries(Object.keys(current).map(key => [key, action.input[key]])))) return { status: "failed", output: { code: "commercial_terms_changed" } };
      } catch { return { status: "failed", output: { code: "order_configuration_unverified" } }; }
      if (context.signal.aborted) return { status: "failed", output: { code: "dispatch_cancelled" } };
      const result = await createServiceSupabase().rpc("submit_process_order", { p_business: scope.businessId, p_conversation: scope.conversationId,
        p_revision: context.revision, p_action: action.id, p_user: null, p_job: scope.lease.jobId, p_token: scope.lease.leaseToken });
      if (result.error) throw new Error(result.error.message); // An uncertain response cannot authorize another dispatch.
      const receipt = result.data;
      if (!receipt || receipt.dispatch !== false || typeof receipt.status !== "string") throw new Error("invalid_order_receipt");
      return { status: "succeeded", output: { submissionStatus: receipt.status, ...(typeof receipt.orderId === "string" ? { orderId: receipt.orderId } : {}),
        localOrderCreated: receipt.status === "local_only", externalOrderSent: false } };
    },
    async reconcile(action, context): Promise<EffectResult | null> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) return null;
      const { data, error } = await createServiceSupabase().from("order_submissions").select("order_id,status,confirmation")
        .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId).eq("confirmation_id", action.id).maybeSingle();
      if (error) return null;
      if (!data) {
        const review = await createServiceSupabase().from("process_order_reviews").select("confirmation")
          .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId).eq("action_id", action.id).maybeSingle();
        if (review.error || review.data?.confirmation?.inputDigest !== action.inputDigest
          || digest(review.data.confirmation.approval) !== digest(action.approval)) return null;
        return { status: "succeeded", output: { submissionStatus: "awaiting_staff", localOrderCreated: false, externalOrderSent: false } };
      }
      if (data.confirmation?.inputDigest !== action.inputDigest) return null;
      return { status: "succeeded", output: { orderId: data.order_id, submissionStatus: data.status, localOrderCreated: true, externalOrderSent: data.status === "accepted" } };
    },
    async simulate() { recordExternalAction({ kind: "order.create", disposition: "SIMULATED", detail: "no_order_created_or_sent" }); return { status: "simulated", localOrderCreated: false, externalOrderSent: false }; },
  };
}
