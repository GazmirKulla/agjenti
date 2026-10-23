import type { ConversationStatePayload } from "@/lib/workflows/engine";
import type { VisualVersion, VisualNode } from "@/lib/workflows/visual/types";
import type { VisualEntity } from "@/lib/workflows/visual/entity-routing";
import { freshOrderReview, getFact, validValue } from "@/lib/workflows/context";
import type { BookingDraft } from "@/lib/calendar/agent";
import { validDate, validTime } from "@/lib/calendar/model";

export type PreparedRequest = {
  domain: "order" | "service" | "booking";
  entity: { id: string; kind: "product" | "service"; name: string };
  collectedFields: Record<string, string>;
  missingFields: string[];
  validation: "incomplete" | "valid" | "unverified";
  review: "collecting" | "ready_for_review" | "review_requested" | "customer_confirmed";
  // A returned nextState is not proof that the transport committed ownership.
  handoff: "not_handed_off" | "requested";
  source: { versionId: string; flowId: string; policyRevision: number };
  /** Manual staff actions are separate and are not inferred from process state. */
  transaction: "not_executed_by_agent";
};
/** Read-only, from the CURRENT adapter facts. Caller supplies a catalog-verified
 * entity, never an ID/name inferred from model prose. No duplicated facts store. */
export function preparedRequest(state: ConversationStatePayload, version: VisualVersion, entity: VisualEntity): PreparedRequest | undefined {
  const visual = state.visual, pin = visual?.collection;
  if (!pin || pin.mode !== "collection_only" || pin.businessId !== version.businessId || pin.versionId !== version.id
    || version.graph.version !== 2 || visual?.binding?.entity.id !== entity.id || visual.binding.entity.kind !== entity.kind) return;
  const flow = version.graph.flows.find(f => f.id === pin.flowId);
  if (!flow || !(entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id)) return;
  const collected: Record<string, string> = {}, missing: string[] = [];
  // Only the chosen branch is required; future/unvisited branches are not facts.
  const seen = new Set<string>(); let id: string | undefined = flow.entryNodeId;
  let unresolvedBranch = false;
  while (id && !seen.has(id)) {
    seen.add(id);
    const n: VisualNode | undefined = version.graph.nodes.find(n => n.id === id);
    if (!n || ["end", "handoff", "booking"].includes(n.kind)) break;
    if (n.kind === "collect" && n.config.fieldKey) {
      const key = n.config.fieldKey, value = getFact(state, key)?.value;
      if (value && validValue(value, n.config.fieldType ?? "text")) collected[key] = value;
      else missing.push(key);
    }
    const port = ["condition", "confirm"].includes(n.kind) ? visual.branchPorts?.[n.id] : "next";
    if (!port) { unresolvedBranch = true; break; }
    id = version.graph.edges.find(e => e.source === n.id && e.port === port)?.target;
  }
  for (const key of pin.profileFields) {
    const fact = state.context?.profile[key];
    if (fact && validValue(fact.value, fact.type)) collected[`customer_${key}`] = fact.value;
    else missing.push(`customer_${key}`);
  }
  const draft = state.fields.booking as BookingDraft | undefined;
  if (pin.domain === "booking") {
    if (draft?.serviceId !== entity.id) return;
    for (const key of ["date", "time", "name"] as const) {
      const value = draft?.[key];
      if (value && (key === "date" ? validDate(value) : key === "time" ? validTime(value) : value.trim().length >= 2)) collected[`booking.${key}`] = value;
      else missing.push(`booking.${key}`);
    }
    if (draft?.contact) collected["booking.contact"] = draft.contact;
  }
  let review: PreparedRequest["review"] = missing.length ? "collecting" : "ready_for_review";
  if (pin.domain === "order") {
    if (freshOrderReview(state, true)) review = "customer_confirmed";
    else if (freshOrderReview(state, false)) review = "review_requested";
  } else if (pin.domain === "booking" && draft?.expires && draft.expires > Date.now() && draft.review && freshBookingFacts(version, draft)) {
    review = draft.preparedConfirmation?.factsKey === draft.review.factsKey ? "customer_confirmed" : "review_requested";
  }
  // Service completion alone is NOT a verified customer confirmation.
  if (missing.length) review = "collecting";
  return { domain: pin.domain, entity: { id: entity.id, kind: entity.kind, name: entity.name }, collectedFields: collected,
    missingFields: [...new Set(missing)], validation: missing.length || state.context?.execution.invalidFields?.length ? "incomplete" : unresolvedBranch ? "unverified" : "valid", review,
    handoff: state.staffHandoff ? "requested" : "not_handed_off", source: { versionId: version.id, flowId: flow.id, policyRevision: pin.revision }, transaction: "not_executed_by_agent" };
}

function freshBookingFacts(version: VisualVersion, draft: BookingDraft) {
  try {
    const key = JSON.parse(draft.review!.factsKey);
    return Array.isArray(key) && JSON.stringify(key.slice(0, 8)) === JSON.stringify([
      version.businessId, version.id, draft.nonce, draft.serviceId ?? null, draft.date ?? null,
      draft.time ?? null, draft.name ?? null, draft.contact ?? null,
    ]);
  } catch { return false; }
}
