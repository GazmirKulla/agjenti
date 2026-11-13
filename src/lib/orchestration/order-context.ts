import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import type { ProcessVersion } from "./linear-definition";
import { TransitionError, type Instance, type Observation, type ProcessDefinition, type Snapshot, type Value } from "./contracts";
import { orderFields } from "./order-definition";
import { digest, validateDefinition } from "./definition";
import { readBusinessFields, type BusinessField } from "@/lib/items/fields";
import { matchVariant, variantChoices, variantFieldId, type ProductVariant } from "@/lib/products/variants";
export type OrderTerms = { productId: string; productName: string; productTypeId: string; unitAmount: number; currency: string; quantity: number };
/** The product's active variants (sizes, lengths…); empty when it has none. */
export async function readProductVariants(businessId: string, productId: string): Promise<ProductVariant[]> {
  const { data, error } = await createServiceSupabase().from("product_variants").select("id,options,sku,price_amount,is_active")
    .eq("business_id", businessId).eq("product_id", productId).eq("is_active", true).order("position");
  if (error) throw new TransitionError("product_unavailable");
  return (data ?? []) as ProductVariant[];
}
/** The price a variant sets: its own, else the product's, else (nothing chosen yet) the lowest variant price. */
export function variantUnitAmount(variants: ProductVariant[], productPrice: number | null, chosen?: Record<string, unknown>) {
  if (!variants.length) return productPrice;
  const variant = chosen ? matchVariant(variants, chosen) : undefined;
  if (variant) return variant.price_amount ?? productPrice;
  const prices = variants.flatMap(v => typeof v.price_amount === "number" ? [v.price_amount] : []);
  return productPrice ?? (prices.length ? Math.min(...prices) : null);
}
export async function readOrderTerms(businessId: string, productId: string, collectionOnly = false, chosen?: Record<string, unknown>) {
  await requireRuntimeModules(businessId, collectionOnly ? ["products", "workflows"] : ["products", "orders", "workflows"]);
  const [{ data, error }, variants] = await Promise.all([
    createServiceSupabase().from("products").select("id,name,product_type_id,price_amount,currency")
      .eq("business_id", businessId).eq("id", productId).eq("is_active", true).maybeSingle(),
    readProductVariants(businessId, productId),
  ]);
  const unitAmount = data ? variantUnitAmount(variants, typeof data.price_amount === "number" ? data.price_amount : null, chosen) : null;
  if (error || !data || !collectionOnly && (typeof unitAmount !== "number" || unitAmount < 0 || !/^[A-Z]{3}$/.test(data.currency ?? ""))) throw new TransitionError("product_unavailable");
  return { productId: data.id, productName: data.name, productTypeId: data.product_type_id ?? "none", unitAmount: unitAmount ?? 0, currency: data.currency ?? "unpriced", quantity: 1 };
}
/** Adds one required choice step per variant field right after the product is chosen,
 * so the agent asks e.g. "Çfarë gjatësie?" before the order review. */
export function composeVariantChoices(definition: ProcessDefinition, variants: ProductVariant[], fields: BusinessField[]): ProcessDefinition {
  const choices = variantChoices(variants, fields);
  if (!choices.length) return definition;
  const productField = orderFields(definition.id).key("productId");
  const composed = structuredClone(definition);
  const added = choices.map(({ field, values }) => ({ id: variantFieldId(field.key), subject: "product_variant", label: field.unit ? `${field.label} (${field.unit})` : field.label,
    type: "choice" as const, required: true, options: values.slice(0, 100) }));
  for (const field of added) if (!composed.fields.some(f => f.id === field.id)) composed.fields.push(field);
  for (const selector of definition.steps) {
    if (selector.kind !== "collect" || selector.fieldId !== productField) continue;
    const own = composed.steps.find(s => s.id === selector.id)!;
    if (own.kind !== "collect") continue;
    const next = composed.steps.find(s => s.id === own.next);
    const anchor = next?.kind === "resolve" ? next : own;
    if (anchor.kind !== "collect" && anchor.kind !== "resolve") continue;
    const destination = anchor.next;
    const ids = added.map(f => `variant_${digest([selector.id, f.id]).slice(0, 16)}`);
    anchor.next = ids[0];
    composed.steps.push(...added.map((f, i) => ({ id: ids[i], kind: "collect" as const, fieldId: f.id, prompt: `Which ${f.label}? Options: ${f.options.join(", ")}`, next: ids[i + 1] ?? destination })));
  }
  for (const step of composed.steps) if (step.kind === "confirm" && step.fieldIds.includes(productField)) {
    step.fieldIds = [...new Set([...step.fieldIds, ...added.map(f => f.id)])];
    step.requiredFieldIds = [...new Set([...(step.requiredFieldIds ?? step.fieldIds), ...added.map(f => f.id)])];
  }
  if (composed.fields.length > 64 || composed.steps.length > 128) throw new TransitionError("product_composition_limit");
  return validateDefinition(composed);
}
export function orderContext(versions: ProcessVersion[]) {
  const terms = new Map<string, OrderTerms>();
  const variants = new Map<string, ProductVariant[]>();
  let fields: BusinessField[] = [];
  const chosenOf = (instance: Instance) => Object.fromEntries(Object.entries(instance.facts).filter(([id]) => id.startsWith("variant_")).map(([id, fact]) => [id, fact.value]));
  return {
    /** The definition with the chosen product's variant questions. */
    withVariants(definition: ProcessDefinition, instance: Instance): ProcessDefinition {
      const productId = instance.facts[orderFields(definition.id).key("productId")]?.value;
      const own = typeof productId === "string" ? variants.get(productId) : undefined;
      return own?.length ? composeVariantChoices(definition, own, fields) : definition;
    },
    /** A different product never keeps the previous product's variant answers. */
    clearVariants(instance: Instance, previousProductId: string | undefined, eventId: string) {
      if (previousProductId === undefined || instance.productWorkflow?.productId === previousProductId) return;
      for (const [id, fact] of Object.entries(instance.facts)) if (id.startsWith("variant_") && fact.eventId !== eventId) delete instance.facts[id];
    },
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
      const productIds = [...new Set([...ids.values()].map(v => v.id))];
      const [business] = await Promise.all([
        productIds.length ? createServiceSupabase().from("businesses").select("product_fields").eq("id", state.businessId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ...productIds.map(async id => { try { variants.set(id, await readProductVariants(state.businessId, id)); } catch { variants.delete(id); } }),
        ...[...ids].map(async ([cacheKey, { id, collectionOnly }]) => {
          try { terms.set(cacheKey, await readOrderTerms(state.businessId, id, collectionOnly)); } catch { terms.delete(cacheKey); }
        }),
      ]);
      fields = business && "data" in business && !business.error ? readBusinessFields((business.data as { product_fields?: unknown } | null)?.product_fields) : [];
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
      const own = variants.get(productId) ?? [];
      const priced = own.length ? { ...current, unitAmount: variantUnitAmount(own, current.unitAmount, chosenOf(instance)) ?? current.unitAmount } : current;
      return { ...Object.fromEntries(Object.entries(priced).map(([name, value]) => [key(name), value])), [key("options")]: JSON.stringify(options) };
    },
  };
}
