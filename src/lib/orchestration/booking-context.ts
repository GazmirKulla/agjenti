import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { Observation, ProcessDefinition, Snapshot, Instance, Value } from "./contracts";
import { TransitionError } from "./contracts";
import { bookingFields, bookingServerValues } from "./booking-definition";
import { readBookingTerms, type BookingTerms } from "./booking";

/** Tenant-scoped reads may prepare context; only the transition validates/accepts observations. */
export function bookingContext(versions: VisualVersion[]) {
  const terms = new Map<string, BookingTerms>();
  function nodes(definition: ProcessDefinition) {
    const version = versions.find(v => v.id === definition.versionId);
    return (version?.graph.nodes ?? []).filter(n => n.kind === "booking" && definition.steps.some(s => s.id === n.id)).map(node => ({
      node, flow: version?.graph.version === 2 ? version.graph.flows.find(f => f.nodeIds.includes(node.id)) : undefined,
    }));
  }
  return {
    async prepare(state: Snapshot, definitions: ProcessDefinition[], observation?: Observation) {
      const ids = new Map<string, boolean>();
      for (const definition of definitions) for (const { node } of nodes(definition)) {
        const fieldId = bookingFields(node.id).key("serviceId");
        const collectionOnly = definition.steps.find(s => s.id === bookingFields(node.id).key("create"))?.kind !== "effect";
        const add = (value: Value | undefined) => { if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.set(`${collectionOnly}:${value}`, collectionOnly); };
        for (const instance of Object.values(state.instances)) if (instance.definitionId === definition.id && instance.versionId === definition.versionId) add(instance.facts[fieldId]?.value);
        for (const command of observation?.commands ?? []) {
          const facts = command.kind === "facts" ? command.values : command.kind === "start" || command.kind === "accept_offer" ? command.initialFacts : [];
          for (const fact of facts) if (fact.fieldId === fieldId) add(fact.value);
        }
      }
      await Promise.all([...ids].map(async ([cacheKey, collectionOnly]) => {
        const id = cacheKey.slice(cacheKey.indexOf(":") + 1);
        try { terms.set(cacheKey, await readBookingTerms(state.businessId, id, collectionOnly)); }
        catch { terms.delete(cacheKey); }
      }));
    },
    serverFacts(definition: ProcessDefinition, instance: Instance): Record<string, Value> {
      const result: Record<string, Value> = {};
      for (const { node, flow } of nodes(definition)) {
        const serviceId = instance.facts[bookingFields(node.id).key("serviceId")]?.value;
        if (typeof serviceId !== "string") continue;
        if (flow?.serviceIds?.length && !flow.serviceIds.includes(serviceId)) throw new TransitionError("service_outside_workflow");
        const collectionOnly = definition.steps.find(s => s.id === bookingFields(node.id).key("create"))?.kind !== "effect";
        const current = terms.get(`${collectionOnly}:${serviceId}`);
        if (current) Object.assign(result, bookingServerValues(node.id, current));
      }
      return result;
    },
  };
}
