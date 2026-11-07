import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import type { ProcessVersion } from "./linear-definition";
import { TransitionError, type Instance, type Observation, type ProcessDefinition, type Snapshot, type Value } from "./contracts";
import { orderFields } from "./order-definition";
export type OrderTerms = { productId: string; productName: string; productTypeId: string; unitAmount: number; currency: string; quantity: number };
export async function readOrderTerms(businessId: string, productId: string, collectionOnly = false) {
  await requireRuntimeModules(businessId, collectionOnly ? ["products", "workflows"] : ["products", "orders", "workflows"]);
  const { data, error } = await createServiceSupabase().from("products").select("id,name,product_type_id,price_amount,currency")
    .eq("business_id", businessId).eq("id", productId).eq("is_active", true).maybeSingle();
  if (error || !data || !collectionOnly && (typeof data.price_amount !== "number" || data.price_amount < 0 || !/^[A-Z]{3}$/.test(data.currency ?? ""))) throw new TransitionError("product_unavailable");
  return { productId: data.id, productName: data.name, productTypeId: data.product_type_id ?? "none", unitAmount: data.price_amount ?? 0, currency: data.currency ?? "unpriced", quantity: 1 };
}
export function orderContext(versions: ProcessVersion[]) {
  const terms = new Map<string, OrderTerms>();
  return {
    async prepare(state: Snapshot, definitions: ProcessDefinition[], observation?: Observation) {
      const ids = new Map<string, { id: string; collectionOnly: boolean }>();
      for (const definition of definitions) {
        const fieldId = orderFields(definition.id).key("productId");
        if (!definition.fields.some(f => f.id === fieldId)) continue;
        const collectionOnly = !!definition.collection;
        const add = (value: Value | undefined) => {
          if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.set(`${collectionOnly}:${value}`, { id: value, collectionOnly });
        };
        for (const instance of Object.values(state.instances)) if (instance.definitionId === definition.id && instance.versionId === definition.versionId) add(instance.facts[fieldId]?.value);
        for (const command of observation?.commands ?? []) {
          const facts = command.kind === "facts" ? command.values : command.kind === "start" || command.kind === "accept_offer" ? command.initialFacts : [];
          facts.filter(f => f.fieldId === fieldId).forEach(f => add(f.value));
        }
      }
      await Promise.all([...ids].map(async ([cacheKey, { id, collectionOnly }]) => {
        try { terms.set(cacheKey, await readOrderTerms(state.businessId, id, collectionOnly)); } catch { terms.delete(cacheKey); }
      }));
    },
    serverFacts(definition: ProcessDefinition, instance: Instance): Record<string, Value> {
      const { key } = orderFields(definition.id), productId = instance.facts[key("productId")]?.value;
      if (typeof productId !== "string") return {};
      const version = versions.find(v => v.id === definition.versionId);
      const flow = version?.graph.version === 2 ? version.graph.flows.find(f => f.id === definition.id) : undefined;
      const pinned = version?.linear && instance.productWorkflow?.productId === productId && instance.productWorkflow.versionId === version.id;
      if (!pinned && flow?.productIds?.length && !flow.productIds.includes(productId)) throw new TransitionError("product_outside_workflow");
      const current = terms.get(`${!!definition.collection}:${productId}`);
      if (!current) return {};
      const options = Object.fromEntries(definition.steps.flatMap(s => s.kind === "collect" && s.fieldId !== key("productId") && !["customer_name", "customer_phone", "customer_city", "customer_address", "customer_email"].includes(s.fieldId)
        && instance.facts[s.fieldId] ? [[s.fieldId, instance.facts[s.fieldId].value]] : []));
      return { ...Object.fromEntries(Object.entries(current).map(([name, value]) => [key(name), value])), [key("options")]: JSON.stringify(options) };
    },
  };
}
