import type { AgentTurnParams } from "./process-agent-turn";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { recentConversation } from "@/lib/workflows/guidance";
import { interpretProcessOffer } from "./interpret-process-offer";
/** Navigation can enter a collector only. It never approves an action node. */
export function availableProcessOffers(version: VisualVersion | null | undefined) {
  return version?.graph.version === 2 ? version.graph.flows.filter(f => f.kind === "custom" && !f.productIds?.length && !f.serviceIds?.length
    && version.graph.nodes.some(n => n.id === f.entryNodeId && n.kind === "collect")
    && f.nodeIds.some(id => version.graph.nodes.some(n => n.id === id && n.kind === "action")))
    .map(f => ({ flowId: f.id, label: f.label, versionId: version.id })) : [];
}
export async function consumeProcessOffer(params: AgentTurnParams, version: VisualVersion | null | undefined): Promise<string | undefined> {
  const state = params.state, offer = state?.processes?.pendingProcessOffer;
  if (!offer) return;
  if (offer.businessId !== params.businessId || !Number.isFinite(offer.expiresAt) || offer.expiresAt <= Date.now()
    || !availableProcessOffers(version).some(o => o.flowId === offer.flowId && o.versionId === offer.versionId)) {
    delete state!.processes!.pendingProcessOffer;
    return;
  }
  const last = state!.recentMessages?.at(-1);
  // Delivery receipts establish visibility, not the meaning of the reply.
  const delivered = last?.role === "assistant" && (params.mode === "test" || params.deliveredReply?.slice(0, 1200) === last.content);
  if (delivered && last.content === offer.prompt) offer.presented = true;
  if (!offer.presented || !delivered || params.hasPhoto || params.hasAttachments || state!.conversationPaused || state!.processes?.informationOnly) return;
  const interpretation = await interpretProcessOffer({ message: params.message, offer, history: recentConversation(state) });
  if (interpretation?.relation === "decline") delete state!.processes!.pendingProcessOffer;
  if (interpretation?.relation !== "accept" || interpretation.flowId !== offer.flowId) return;
  delete state!.processes!.pendingProcessOffer;
  return offer.flowId;
}
