import type { PreparedRequest } from "@/lib/conversations/prepared-request";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { Instance, ProcessDefinition } from "./contracts";
import { bookingFields } from "./booking-definition";
import { orderFields } from "./order-definition";
import { serviceFields } from "./service-definition";
import { digest } from "./definition";

/** Read-only UI projection. Facts and approval receipts remain in the authoritative instance. */
export function processPreparedRequest(instance: Instance, definition: ProcessDefinition, version: VisualVersion, now: number): PreparedRequest | undefined {
  if (!definition.collection || definition.policyKey !== instance.policyKey) return;
  const booking = version.graph.nodes.find(n => n.kind === "booking" && definition.steps.some(s => s.id === n.id)
    && typeof instance.facts[bookingFields(n.id).key("serviceId")]?.value === "string");
  const order = orderFields(definition.id), service = serviceFields(definition.id);
  const idKey = booking ? bookingFields(booking.id).key("serviceId") : definition.collection.domain === "order" ? order.key("productId") : service.key("id");
  const nameKey = booking ? bookingFields(booking.id).key("serviceName") : definition.collection.domain === "order" ? order.key("productName") : service.key("name");
  const id = instance.facts[idKey]?.value, name = instance.facts[nameKey]?.value;
  if (typeof id !== "string" || typeof name !== "string") return;
  const relevant = new Set(definition.steps.flatMap(s => s.kind === "collect" && ((instance.visited ?? []).includes(s.id)
    || s.id === instance.stepId || booking && bookingFields(booking.id).customer.some(f => f.id === s.fieldId)) ? [s.fieldId] : []));
  const fields = definition.fields.filter(f => f.source !== "server" && relevant.has(f.id));
  const missing = fields.filter(f => f.required && !instance.facts[f.id]).map(f => f.id);
  const confirmed = instance.confirmedReviews?.some(review => review.expiresAt > now && review.factDigest === digest(review.fieldIds.map(fieldId => [fieldId, instance.facts[fieldId] ?? null])));
  return { domain: definition.collection.domain, entity: { id, kind: definition.collection.domain === "order" ? "product" : "service", name },
    collectedFields: Object.fromEntries(fields.flatMap(f => instance.facts[f.id] ? [[f.id, String(instance.facts[f.id].value)]] : [])),
    missingFields: missing, validation: missing.length ? "incomplete" : instance.status === "waiting_input" ? "unverified" : "valid",
    review: missing.length ? "collecting" : confirmed ? "customer_confirmed" : instance.wait?.kind === "approval" ? "review_requested" : "ready_for_review",
    handoff: instance.status === "handoff" ? "requested" : "not_handed_off", transaction: "not_executed_by_agent",
    source: { versionId: version.id, flowId: definition.id, policyRevision: definition.collection.revision } };
}
