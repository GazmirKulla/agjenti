import { sharedWorkflowEnabled } from "@/lib/workflows/context";
import type { AgentTurnParams } from "./process-agent-turn";

/** Routing policy is independent of a queue lease, which only authorizes effects.
 * Removing a pilot stops new migrations; existing v3 conversations keep their tasks.
 */
export function usesSharedCoordinator(params: Pick<AgentTurnParams, "businessId" | "source" | "mode" | "state" | "visualPreview">): boolean {
  return params.mode === "test" || Boolean(params.visualPreview)
    || params.state?.schemaVersion === 3 || Boolean(params.state?.processes)
    || params.source === "whatsapp" || sharedWorkflowEnabled(params.businessId);
}
