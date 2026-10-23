import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { extractExplicitFacts, freshOrderReview, invalidateOrderReview } from "@/lib/workflows/context";
import { bookingAdapterState, currentProcessOwner, snapshotOrder } from "@/lib/workflows/conversation-processes";
import { advanceVisualOrderReview } from "@/lib/workflows/visual/product-order";
import { resolveVisualEntity } from "@/lib/workflows/visual/entity-routing";
import { capabilityModules, requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { flowCapabilityKeys, nodeCapabilityKeys } from "@/lib/capabilities/graph";
import { collectionForNode, blocked } from "@/lib/runtime/collection-policy";
import { withCollectionPolicy } from "@/lib/runtime/execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";
import { preparedRequest, type PreparedRequest } from "./prepared-request";

/** A terminal collection receipt is not an active prompt. Handle labelled repairs
 * before generic fact extraction can invalidate it and route away from its owner.
 * This only reissues the existing final review; it never runs graph actions. */
export async function correctPreparedRequest(input: {
  businessId: string; message: string; state: ConversationStatePayload; version: VisualVersion | null;
}): Promise<{ state: ConversationStatePayload; reply: string; preparedRequest?: PreparedRequest; corrected: boolean } | undefined> {
  const { state, version, businessId, message } = input;
  const visual = state.visual, pin = visual?.collection;
  if (visual?.status !== "completed" || pin?.mode !== "collection_only" || !/^.{1,80}?:\s*\S/.test(message)) return;
  const reject = (reply: string, projection?: PreparedRequest) => ({ state, reply, preparedRequest: projection, corrected: false });
  const p = state.processes;
  if (state.staffHandoff || state.conversationPaused || !p || p.informationOnly || p.active || currentProcessOwner(state)
    || p.pendingChoice || p.pendingClarification || p.auxiliary)
    return reject("Kërkesa nuk u ndryshua. Qartëso me stafin ose rifillo shprehimisht procesin përkatës.");
  if (!version || version.businessId !== businessId || version.id !== visual.versionId || pin.businessId !== businessId) throw blocked();
  const policy = collectionForNode(version, visual.nodeId, pin);
  if (!policy || policy.mode !== "collection_only" || policy.flowId !== visual.binding?.flowId) throw blocked();
  const flow = version.graph.version === 2 && version.graph.flows.find(f => f.id === policy.flowId);
  if (!flow) throw blocked();
  await requireRuntimeModules(businessId, ["workflows", ...capabilityModules([
    ...flowCapabilityKeys(flow), ...version.graph.nodes.filter(n => flow.nodeIds.includes(n.id) && visual.visited.includes(n.id)).flatMap(nodeCapabilityKeys),
  ]), ...(flow.serviceIds?.length ? ["services"] : [])]);
  const resolved = await resolveVisualEntity(businessId, version.graph, "", visual.binding, false, { state });
  const selected = resolved.selected;
  if (!selected || selected.binding.flowId !== visual.binding.flowId || selected.entity.id !== visual.binding.entity.id
    || selected.entity.kind !== visual.binding.entity.kind) throw blocked();
  let ownedState = state;
  if (policy.domain === "service") {
    const service = p.service;
    if (!service || service.status !== "completed" || service.versionId !== version.id || service.visual.binding?.entity.id !== selected.entity.id)
      return reject("Nuk u identifikua kërkesa e përfunduar për korrigjim. Kontakto stafin; të dhënat nuk u ndryshuan.");
    ownedState = structuredClone(state);
    ownedState.context!.order = structuredClone(service.order);
    ownedState.fields = structuredClone(service.fields);
    ownedState.visual = structuredClone(service.visual);
  } else if (policy.domain === "booking") {
    if (!p.booking || p.booking.versionId !== version.id || p.booking.visual?.binding?.entity.id !== selected.entity.id)
      return reject("Nuk u identifikuan preferencat e rezervimit për korrigjim. Kontakto stafin; të dhënat nuk u ndryshuan.");
    ownedState = bookingAdapterState(state);
  }
  const projection = preparedRequest(ownedState, version, selected.entity);
  // Services have no final-review receipt/expiry. Booking preferences keep their
  // own draft confirmation. Do not manufacture either from a completed cursor.
  if (policy.domain !== "order") return reject("Korrigjimi pas përfundimit nuk mbështetet për këtë kërkesë. Të dhënat nuk u ndryshuan; kërko ndihmën e stafit ose nis një kërkesë të re.", projection);
  const task = p.order, saved = task?.snapshot.visual;
  if (!task || task.status !== "completed" || state.context?.execution.factOwner !== "order" || state.step_key !== "order_ready"
    || state.product_id !== selected.entity.id || saved?.versionId !== visual.versionId || saved.nodeId !== visual.nodeId
    || saved.binding?.entity.id !== selected.entity.id || saved.binding.flowId !== visual.binding.flowId
    || task.snapshot.execution.orderReview?.id !== state.context.execution.orderReview?.id
    || version.graph.nodes.find(n => n.id === visual.nodeId)?.kind !== "end"
    || !freshOrderReview(state, true) || projection?.validation !== "valid")
    return reject("Shqyrtimi i mëparshëm nuk është më i vlefshëm për korrigjim. Të dhënat nuk u ndryshuan; nis një kërkesë të re ose kontakto stafin.", projection);
  const receipt = state.context.execution.orderReview!;
  if (!receipt.id) return reject("Kërkesa e vjetër nuk ka identifikues shqyrtimi. Kontakto stafin për korrigjim.", projection);
  // Staff may already have submitted this receipt. Collection-only prevents
  // automatic effects, but does not authorize editing a completed transaction.
  const { data: submitted, error } = await createServiceSupabase().from("order_submissions").select("order_id")
    .eq("business_id", businessId).eq("confirmation_id", receipt.id).limit(1).maybeSingle();
  if (error) throw blocked();
  if (submitted) return reject("Kjo kërkesë është dërguar tashmë. Kontakto stafin për ndryshime; porosia nuk u ndryshua.", projection);
  const candidate = structuredClone(state);
  // One labelled value, validated by the existing extractor. Never partially
  // apply a compound/invalid repair, or skip graph branches for a graph field.
  const probe = structuredClone(state);
  probe.context!.profile = {};
  const accepted = !/[\n;,]/.test(message) && extractExplicitFacts(probe, message) === 1;
  const fields = Object.keys(probe.context!.profile);
  if (!accepted || fields.length !== 1 || fields.some(key => !policy.profileFields.includes(key as typeof policy.profileFields[number]))
    || version.graph.nodes.some(n => n.config.fieldKey && fields.some(key => n.config.fieldKey === `customer_${key}`)))
    return reject("Korrigjimi nuk u ruajt. Dërgo një fushë të vlefshme nga përmbledhja, p.sh. “telefoni: +355…”. Fushat që ndryshojnë rrjedhën kërkojnë një kërkesë të re.", projection);
  extractExplicitFacts(candidate, message);
  invalidateOrderReview(candidate.context!.execution);
  delete candidate.visual!.pendingConfirmation;
  delete candidate.visual!.confirmedConfirmation;
  delete candidate.completedVisual;
  for (const key of policy.profileFields) {
    const value = candidate.context!.profile[key]?.value;
    if (value) candidate.visual!.values[`customer_${key}`] = value;
  }
  candidate.step_key = "order_confirm";
  candidate.visual!.status = "waiting"; candidate.visual!.awaiting = true;
  const review = withCollectionPolicy(policy, () => advanceVisualOrderReview(candidate, "", false, false, version.graph, selected.entity.name));
  const next = review.nextState;
  next.processes!.order = { id: task.id, status: "active", snapshot: snapshotOrder(next) };
  next.processes!.active = "order"; next.processes!.promptOwner = "order";
  return { state: next, reply: review.reply, preparedRequest: preparedRequest(next, version, selected.entity), corrected: true };
}
