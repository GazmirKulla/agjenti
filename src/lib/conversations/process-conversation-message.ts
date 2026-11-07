import { withAiUsage } from "@/lib/ai/usage";
import { processConversation } from "@/lib/orchestration/conversation";
import type { AgentTurnParams, AgentTurnResult } from "./process-agent-turn";
import type { OrderCustomerIdentity } from "@/lib/orders/own-orders";
import type { BookingEffectGuard } from "@/lib/calendar/service";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";
import { runIsolated } from "@/lib/runtime/isolated-run";

export type ConversationMessageParams = AgentTurnParams & {
  /** Server webhook identity, never accepted from chat text or preview state. */
  customerIdentity?: OrderCustomerIdentity;
  conversationKey?: string;
  bookingGuard?: BookingEffectGuard;
  /** Production adapter rechecks manual ownership immediately before booking effects. */
  canAct?: () => Promise<boolean>;
};
/** The single conversation entry point. Transport owns identity, persistence and delivery. */
export async function processConversationMessage(params: ConversationMessageParams): Promise<AgentTurnResult> {
  if (params.configurationPreview && (params.mode !== "test" || params.configurationPreview.businessId !== params.businessId)) throw new Error("invalid_configuration_preview");
  const isolated = params.source === "admin_chat_lab" || params.mode === "test" || !!params.visualPreview || !!params.linearPreview || isIsolatedExecution();
  if (isolated && !isIsolatedExecution()) return runIsolated(() => processConversationMessage({ ...params, mode: "test" }));
  return withAiUsage(params.businessId, () => processConversation(isolated ? { ...params, mode: "test" } : params));
}
