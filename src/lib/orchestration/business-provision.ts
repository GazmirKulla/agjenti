import { provisionBusiness } from "@/lib/actions/provision";
import { parseProvisionInput } from "@/lib/actions/catalog";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { TransitionError } from "./contracts";
import type { EffectResult, ToolAdapter } from "./execute";
import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { digest } from "./definition";
import type { ProcessLease } from "./persistence";

/** The domain RPC rechecks lease, current revision, tenant, ownership, policy and quota.
 * Called only after executePreparedAction has committed the durable running claim.
 */
export function businessProvisionAdapter(scope?: {
  businessId: string; conversationId: string; lease: ProcessLease;
  versionForInstance: (instanceId: string) => string | undefined;
}): ToolAdapter {
  return {
    key: "business.provision", version: 1,
    async execute(action, context) {
      if (isIsolatedExecution() || !scope || context.businessId !== scope.businessId || context.conversationId !== scope.conversationId)
        throw new TransitionError("effect_scope_mismatch");
      const version = scope.versionForInstance(action.instanceId);
      if (!version || context.signal.aborted) return { status: "failed", output: {} };
      const input = parseProvisionInput(action.input);
      const result = await provisionBusiness({ businessId: scope.businessId, userId: null,
        // An action identity distinguishes two requests with identical values; retries reuse it.
        requestId: `process:${scope.conversationId}:${action.id}`, input,
        workflowVersionId: version, nodeId: action.stepId, conversationId: scope.conversationId,
        guard: { ...scope.lease, conversationId: scope.conversationId, revision: context.revision },
      });
      return { status: "succeeded", output: result };
    },
    async reconcile(action, context): Promise<EffectResult | null> {
      if (isIsolatedExecution() || !scope || context.businessId !== scope.businessId || context.conversationId !== scope.conversationId) return null;
      const db = createServiceSupabase();
      const execution = await db.from("action_executions").select("id,input,status")
        .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId).eq("action_key", "business.provision")
        .eq("request_key", `process:${scope.conversationId}:${action.id}`).maybeSingle();
      if (execution.error || execution.data?.status !== "succeeded" || digest(execution.data.input) !== digest(parseProvisionInput(action.input))) return null;
      const invitation = await db.from("business_invitations").select("target_business_id,status,expires_at,token_ciphertext")
        .eq("source_business_id", scope.businessId).eq("execution_id", execution.data.id).maybeSingle();
      if (invitation.error || !invitation.data) return null;
      const data = invitation.data, origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      const pending = data.status === "pending" && Date.parse(data.expires_at) > Date.now();
      return { status: "succeeded", output: { businessId: data.target_business_id, expiresAt: data.expires_at, invitationStatus: data.status === "pending" && !pending ? "expired" : data.status,
        ...(pending && origin ? { invitationUrl: `${origin}/join?request=${decryptSecret(data.token_ciphertext)}` } : {}) } };
    },
    async simulate(action) {
      parseProvisionInput(action.input);
      recordExternalAction({ kind: "action.provision", disposition: "SIMULATED", detail: "process_runtime_not_provisioned" });
      return { businessId: "simulation", invitationUrl: "[SIMULIM: link regjistrimi — nuk u krijua biznes]", expiresAt: "[SIMULIM]" };
    },
  };
}
