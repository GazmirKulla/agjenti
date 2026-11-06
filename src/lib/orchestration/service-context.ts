import type { VisualVersion } from "@/lib/workflows/visual/types";
import type { Instance, Observation, ProcessDefinition, Snapshot, Value } from "./contracts";
import { TransitionError } from "./contracts";
import { serviceFields } from "./service-definition";
import { readBookingTerms } from "./booking";
export function serviceContext(versions: VisualVersion[]) {
  const names = new Map<string, string>();
  return {
    async prepare(state: Snapshot, definitions: ProcessDefinition[], observation?: Observation) {
      const ids = new Set<string>();
      for (const definition of definitions) {
        const fieldId = serviceFields(definition.id).key("id");
        if (!definition.fields.some(f => f.id === fieldId)) continue;
        const add = (value: Value | undefined) => { if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.add(value); };
        for (const instance of Object.values(state.instances)) if (instance.definitionId === definition.id && instance.versionId === definition.versionId) add(instance.facts[fieldId]?.value);
        for (const command of observation?.commands ?? []) {
          const facts = command.kind === "facts" ? command.values : command.kind === "start" || command.kind === "accept_offer" ? command.initialFacts : [];
          facts.filter(f => f.fieldId === fieldId).forEach(f => add(f.value));
        }
      }
      await Promise.all([...ids].map(async id => { try { names.set(id, (await readBookingTerms(state.businessId, id, true)).serviceName); } catch { names.delete(id); } }));
    },
    serverFacts(definition: ProcessDefinition, instance: Instance): Record<string, Value> {
      const { key } = serviceFields(definition.id), id = instance.facts[key("id")]?.value;
      if (typeof id !== "string") return {};
      const version = versions.find(v => v.id === definition.versionId), flow = version?.graph.version === 2 ? version.graph.flows.find(f => f.id === definition.id) : undefined;
      if (!flow?.serviceIds?.includes(id)) throw new TransitionError("service_outside_workflow");
      const name = names.get(id);
      return name ? { [key("name")]: name } : {};
    },
  };
}
