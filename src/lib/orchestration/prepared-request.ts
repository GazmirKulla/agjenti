import type { PreparedRequest } from "@/lib/conversations/prepared-request";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { Instance, ProcessDefinition } from "./contracts";
import { bookingFields } from "./booking-definition";
import { digest } from "./definition";

/** UI projection only. Facts and approvals remain in the authoritative instance. */
export function processPreparedRequest(instance: Instance, definition: ProcessDefinition, version: VisualVersion, now: number): PreparedRequest | undefined {
  if (!definition.collection || definition.policyKey !== instance.policyKey) return;
  const node = version.graph.nodes.find(n => n.kind === "booking" && definition.steps.some(s => s.id === n.id)
    && typeof instance.facts[bookingFields(n.id).key("serviceId")]?.value === "string");
  if (!node) return;
  const { key } = bookingFields(node.id), serviceId = instance.facts[key("serviceId")]?.value, serviceName = instance.facts[key("serviceName")]?.value;
  if (typeof serviceId !== "string" || typeof serviceName !== "string") return;
  const fields = definition.fields.filter(f => f.source !== "server" && (f.subject === bookingFields(node.id).fields[0].subject
    || definition.steps.some(s => s.kind === "collect" && s.fieldId === f.id && (instance.visited ?? []).includes(s.id))));
  const missing = fields.filter(f => f.required && !instance.facts[f.id]).map(f => f.id);
  const confirmed = instance.confirmedReviews?.some(review => review.expiresAt > now && review.factDigest === digest(review.fieldIds.map(id => [id, instance.facts[id] ?? null])));
  return { domain: definition.collection.domain, entity: { id: serviceId, kind: "service", name: serviceName },
    collectedFields: Object.fromEntries(fields.flatMap(f => instance.facts[f.id] ? [[f.id, String(instance.facts[f.id].value)]] : [])),
    missingFields: missing, validation: missing.length ? "incomplete" : "valid",
    review: missing.length ? "collecting" : confirmed ? "customer_confirmed" : instance.wait?.kind === "approval" ? "review_requested" : "ready_for_review",
    handoff: instance.status === "handoff" ? "requested" : "not_handed_off", transaction: "not_executed_by_agent",
    source: { versionId: version.id, flowId: definition.id, policyRevision: definition.collection.revision } };
}
