import { provisionBusiness } from "@/lib/actions/provision";
import { parseProvisionInput } from "@/lib/actions/catalog";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { TransitionError } from "./contracts";
import type { ToolAdapter } from "./execute";
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
    async simulate(action) {
      parseProvisionInput(action.input);
      recordExternalAction({ kind: "action.provision", disposition: "SIMULATED", detail: "process_runtime_not_provisioned" });
      return { businessId: "simulation", invitationUrl: "[SIMULIM: link regjistrimi — nuk u krijua biznes]", expiresAt: "[SIMULIM]" };
    },
  };
}
