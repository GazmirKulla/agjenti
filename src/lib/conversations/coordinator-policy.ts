import { sharedWorkflowEnabled } from "@/lib/workflows/context";
import type { AgentTurnParams } from "./process-agent-turn";

/** Both live channels use the same coordinator, independent of queue ownership.
 * Saved work migrates through the coordinator without resetting pinned tasks.
 */
export function usesSharedCoordinator(params: Pick<AgentTurnParams, "businessId" | "source" | "mode" | "state" | "visualPreview">): boolean {
  return params.mode === "test" || Boolean(params.visualPreview)
    || params.state?.schemaVersion === 3 || Boolean(params.state?.processes)
    || params.source === "instagram" || params.source === "whatsapp" || sharedWorkflowEnabled(params.businessId);
}
