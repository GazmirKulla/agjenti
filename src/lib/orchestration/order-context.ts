import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import type { ProcessVersion } from "./linear-definition";
import { TransitionError, type Field, type Instance, type Observation, type ProcessDefinition, type Snapshot, type Value } from "./contracts";
import { orderFields, orderQuantityBounds } from "./order-definition";
import { digest, validFieldValue, validateDefinition } from "./definition";
import { readBusinessFields, type BusinessField } from "@/lib/items/fields";
import { choiceLists, matchVariant, variantChoices, variantFieldId, type ChoiceLists, type ProductVariant } from "@/lib/products/variants";
import { orderablePrice } from "@/lib/products/pricing";
import type { LinkedSpec } from "@/lib/integrations/linked-catalog";
export type OrderTerms = { productId: string; productName: string; productTypeId: string; unitAmount: number; currency: string; quantity: number };
/** What the customer orders of a product priced per unit (m³, m…): a number in that unit, asked after the product. */
export const orderQuantityField = "order_quantity";
const quantityField: Field = { id: orderQuantityField, subject: "order_line", label: "Quantity", type: "number", required: true, ...orderQuantityBounds };
export const validOrderQuantity = (value: unknown): value is number => typeof value === "number" && validFieldValue(quantityField, value);
const priceUnitOf = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
/** The product's active variants (sizes, lengths…); empty when it has none. */
export async function readProductVariants(businessId: string, productId: string): Promise<ProductVariant[]> {
  const { data, error } = await createServiceSupabase().from("product_variants").select("id,options,sku,price_amount,is_active")
    .eq("business_id", businessId).eq("product_id", productId).eq("is_active", true).order("position");
  if (error) throw new TransitionError("product_unavailable");
  return (data ?? []) as ProductVariant[];
}
/** The price a variant sets: its own, else the product's orderable price, else (nothing chosen yet) the lowest variant price.
 * productPrice is null when the product's own price is not one fixed number (from, range, on request). */
export function variantUnitAmount(variants: ProductVariant[], productPrice: number | null, chosen?: Record<string, unknown>) {
  if (!variants.length) return productPrice;
  const variant = chosen ? matchVariant(variants, chosen) : undefined;
  if (variant) return variant.price_amount ?? productPrice;
  const prices = variants.flatMap(v => typeof v.price_amount === "number" ? [v.price_amount] : []);
  return productPrice ?? (prices.length ? Math.min(...prices) : null);
}
type OrderProduct = { terms: OrderTerms; basePrice: number | null; lists: ChoiceLists; priceUnit: string | null;
  /** A product linked to the business website: what its catalog declares the order needs. */
  spec: LinkedSpec | null };
/** requested: the reviewed quantity. It counts only for a product priced per unit; any other product is one item. */
async function readOrderProduct(businessId: string, productId: string, collectionOnly: boolean, chosen?: Record<string, unknown>, requested?: unknown): Promise<OrderProduct> {
  await requireRuntimeModules(businessId, collectionOnly ? ["products", "workflows"] : ["products", "orders", "workflows"]);
  const [{ data, error }, variants] = await Promise.all([
    createServiceSupabase().from("products").select("id,name,product_type_id,price_amount,price_mode,price_unit,currency,attributes,source,external_spec")
      .eq("business_id", businessId).eq("id", productId).eq("is_active", true).maybeSingle(),
    readProductVariants(businessId, productId),
  ]);
  // Only a fixed product price is orderable; "from", ranges and on-request prices need a priced variant.
  const basePrice = data ? orderablePrice(data) : null;
  const unitAmount = data ? variantUnitAmount(variants, basePrice, chosen) : null;
  if (error || !data || !collectionOnly && (typeof unitAmount !== "number" || unitAmount < 0 || !/^[A-Z]{3}$/.test(data.currency ?? ""))) throw new TransitionError("product_unavailable");
  const priceUnit = priceUnitOf(data.price_unit);
  if (priceUnit && requested !== undefined && !validOrderQuantity(requested)) throw new TransitionError("invalid_quantity");
  const quantity = priceUnit && validOrderQuantity(requested) ? requested : 1;
  const spec = data.source === "linked" ? readSpec(data.external_spec) : null;
  return { basePrice, lists: choiceLists(data.attributes), priceUnit, spec,
    terms: { productId: data.id, productName: data.name, productTypeId: data.product_type_id ?? "none", unitAmount: unitAmount ?? 0, currency: data.currency ?? "unpriced", quantity } };
}
export async function readOrderTerms(businessId: string, productId: string, collectionOnly = false, chosen?: Record<string, unknown>, quantity?: unknown) {
  return (await readOrderProduct(businessId, productId, collectionOnly, chosen, quantity)).terms;
}
/** The catalog declaration when it has the expected shape; anything else asks nothing more. */
function readSpec(raw: unknown): LinkedSpec | null {
  const spec = raw && typeof raw === "object" ? (raw as Partial<LinkedSpec>) : null;
  return spec && Array.isArray(spec.options) && Array.isArray(spec.fields) ? { version: spec.version === 1 ? 1 : 2, options: spec.options, addons: Array.isArray(spec.addons) ? spec.addons : [], fields: spec.fields } : null;
}
const SPEC_FIELD_TYPES: Record<string, Field["type"]> = { text: "text", number: "number", boolean: "boolean", date: "date", choice: "choice", photo: "photo", file: "photo" };
/** The facts a linked product's catalog asks for, by key: its variant choices (variant_<key>) and the rest under the catalog's own key. */
export function specFieldIds(spec: LinkedSpec, variants: ProductVariant[]): string[] {
  const variantKeys = new Set(variants.filter(v => v.is_active).flatMap(v => Object.keys(v.options)));
  return [...spec.options.map(o => variantKeys.has(o.key) ? variantFieldId(o.key) : o.key),
    ...spec.fields.filter(f => (f.appliesTo ?? "item") === "item" && f.role !== "output" && SPEC_FIELD_TYPES[f.type]).map(f => f.key)];
}
/**
 * For a product linked to the business website: asks, right after the product, what its catalog
 * declares: the variant (format, size…) from the active variants, the other choices (theme, color…)
 * and the item details (character, date, photo…), under the catalog's own keys; only the required
 * ones are asked, the optional ones are accepted when the customer gives them. The questions follow
 * the catalog as "Rifresko nga webi" last stored it; nothing is saved in a workflow. A question the
 * workflow already asks under the same key is not asked twice. The server maps the answers to the
 * website's ids when the order is sent (process_order_selection).
 */
export function composeSpecChoices(definition: ProcessDefinition, spec: LinkedSpec, variants: ProductVariant[]): ProcessDefinition {
  const active = variants.filter(v => v.is_active);
  const variantKeys = new Set(active.flatMap(v => Object.keys(v.options)));
  const added: Field[] = [];
  for (const option of spec.options) {
    const variant = variantKeys.has(option.key);
    const offered = variant ? [...new Set(active.flatMap(v => v.options[option.key] ? [v.options[option.key]] : []))] : option.values.map(v => v.name);
    if (!offered.length) continue;
    added.push({ id: variant ? variantFieldId(option.key) : option.key, subject: variant ? "product_variant" : "product_option", label: option.label,
      type: "choice", required: variant || option.required !== false, options: offered.slice(0, 100) });
  }
  for (const field of spec.fields) {
    const type = SPEC_FIELD_TYPES[field.type];
    // The business's output (a processed design) is never the customer's to give.
    if (!type || (field.appliesTo ?? "item") !== "item" || field.role === "output") continue;
    const values = field.type === "choice" ? (field.values ?? []).map(v => v.name) : [];
    if (field.type === "choice" && !values.length) continue;
    added.push({ id: field.key, subject: "order_line", label: field.label, type, required: field.required === true,
      ...(values.length ? { options: values.slice(0, 100) } : {}),
      ...(type === "number" && typeof field.min === "number" ? { min: field.min } : {}), ...(type === "number" && typeof field.max === "number" ? { max: field.max } : {}) });
  }
  const fresh = added.filter(f => !definition.fields.some(existing => existing.id === f.id));
  if (!fresh.length) return definition;
  const composed = structuredClone(definition);
  composed.fields.push(...fresh);
  const prompt = (f: Field) => f.type === "choice" ? `Which ${f.label}? Options: ${f.options!.join(", ")}`
    : f.type === "photo" ? `Ask the customer to send the photo for: ${f.label}.` : `${f.label}?`;
  // Only what the website requires gets its own question; an optional choice (a color with a store
  // default) is taken when the customer mentions it.
  const asked = fresh.filter(f => f.required);
  if (asked.length) insertAfterProduct(definition, composed, (selectorId, destination) => {
    const ids = asked.map(f => `spec_${digest([selectorId, f.id]).slice(0, 16)}`);
    composed.steps.push(...asked.map((f, i) => ({ id: ids[i], kind: "collect" as const, fieldId: f.id, prompt: prompt(f), next: ids[i + 1] ?? destination })));
    return ids[0];
  });
  addToReview(definition, composed, asked.map(f => f.id));
  if (composed.fields.length > 64 || composed.steps.length > 128) throw new TransitionError("product_composition_limit");
  return validateDefinition(composed);
}
/** Inserts steps right after the product is chosen (after its server terms when they are resolved there). */
function insertAfterProduct(definition: ProcessDefinition, composed: ProcessDefinition, insert: (selectorId: string, destination: string) => string) {
  const productField = orderFields(definition.id).key("productId");
  for (const selector of definition.steps) {
    if (selector.kind !== "collect" || selector.fieldId !== productField) continue;
    const own = composed.steps.find(s => s.id === selector.id)!;
    if (own.kind !== "collect") continue;
    const next = composed.steps.find(s => s.id === own.next);
    const anchor = next?.kind === "resolve" ? next : own;
    if (anchor.kind !== "collect" && anchor.kind !== "resolve") continue;
    anchor.next = insert(selector.id, anchor.next);
  }
}
/** Adds fields to the order review that includes the product. */
function addToReview(definition: ProcessDefinition, composed: ProcessDefinition, ids: string[]) {
  const productField = orderFields(definition.id).key("productId");
  for (const step of composed.steps) if (step.kind === "confirm" && step.fieldIds.includes(productField)) {
    step.fieldIds = [...new Set([...step.fieldIds, ...ids])];
    step.requiredFieldIds = [...new Set([...(step.requiredFieldIds ?? step.fieldIds), ...ids])];
  }
}
/** For a product priced per unit, asks how much of that unit the customer wants (0.5 m³), right after
 * the product and before the review. The model reads the answer as a number; the server checks its bounds. */
export function composeOrderQuantity(definition: ProcessDefinition, unit: string): ProcessDefinition {
  if (definition.fields.some(f => f.id === orderQuantityField)) return definition;
  const composed = structuredClone(definition);
  const label = `Quantity in ${unit}`;
  composed.fields.push({ ...quantityField, label });
  insertAfterProduct(definition, composed, (selectorId, destination) => {
    const id = `quantity_${digest([selectorId, orderQuantityField]).slice(0, 16)}`;
    composed.steps.push({ id, kind: "collect", fieldId: orderQuantityField, prompt: `How much, in ${unit}? Parts of a ${unit} are allowed.`, next: destination });
    return id;
  });
  addToReview(definition, composed, [orderQuantityField]);
  if (composed.fields.length > 64 || composed.steps.length > 128) throw new TransitionError("product_composition_limit");
  return validateDefinition(composed);
}
/** Adds one required choice step per variant field right after the product is chosen,
 * so the agent asks e.g. "Çfarë gjatësie?" before the order review. The values come from
 * the variant rows or, when there are none, from the lists kept on the product. */
export function composeVariantChoices(definition: ProcessDefinition, variants: ProductVariant[], fields: BusinessField[], lists: ChoiceLists = {}): ProcessDefinition {
  const choices = variantChoices(variants, fields, lists);
  if (!choices.length) return definition;
  const composed = structuredClone(definition);
  const added = choices.map(({ field, values }) => ({ id: variantFieldId(field.key), subject: "product_variant", label: field.unit ? `${field.label} (${field.unit})` : field.label,
    type: "choice" as const, required: true, options: values.slice(0, 100) }));
  for (const field of added) if (!composed.fields.some(f => f.id === field.id)) composed.fields.push(field);
  insertAfterProduct(definition, composed, (selectorId, destination) => {
    const ids = added.map(f => `variant_${digest([selectorId, f.id]).slice(0, 16)}`);
    composed.steps.push(...added.map((f, i) => ({ id: ids[i], kind: "collect" as const, fieldId: f.id, prompt: `Which ${f.label}? Options: ${f.options.join(", ")}`, next: ids[i + 1] ?? destination })));
    return ids[0];
  });
  addToReview(definition, composed, added.map(f => f.id));
  if (composed.fields.length > 64 || composed.steps.length > 128) throw new TransitionError("product_composition_limit");
  return validateDefinition(composed);
}
export function orderContext(versions: ProcessVersion[]) {
  const terms = new Map<string, OrderTerms>();
  const variants = new Map<string, ProductVariant[]>();
  const bases = new Map<string, number | null>();
  const lists = new Map<string, ChoiceLists>();
  const units = new Map<string, string | null>();
  const specs = new Map<string, LinkedSpec | null>();
  let fields: BusinessField[] = [];
  const chosenOf = (instance: Instance) => Object.fromEntries(Object.entries(instance.facts).filter(([id]) => id.startsWith("variant_")).map(([id, fact]) => [id, fact.value]));
  return {
    /** The definition with the chosen product's variant questions and, when it is priced per unit, its quantity. */
    withVariants(definition: ProcessDefinition, instance: Instance): ProcessDefinition {
      const productId = instance.facts[orderFields(definition.id).key("productId")]?.value;
      if (typeof productId !== "string") return definition;
      const own = variants.get(productId) ?? [], listed = lists.get(productId) ?? {}, unit = units.get(productId), spec = specs.get(productId);
      const measured = unit ? composeOrderQuantity(definition, unit) : definition;
      // A linked product: its catalog declares the variant and everything else, under the website's keys.
      if (spec) return composeSpecChoices(measured, spec, own);
      return own.length || Object.keys(listed).length ? composeVariantChoices(measured, own, fields, listed) : measured;
    },
    /** A different product never keeps the previous product's variant answers or quantity. */
    clearVariants(instance: Instance, previousProductId: string | undefined, eventId: string) {
      if (previousProductId === undefined || instance.productWorkflow?.productId === previousProductId) return;
      // The previous linked product's catalog answers (theme, character…) belong to it too.
      const previousSpec = specs.get(previousProductId);
      const specIds = new Set(previousSpec ? specFieldIds(previousSpec, variants.get(previousProductId) ?? []) : []);
      for (const [id, fact] of Object.entries(instance.facts))
        if ((id.startsWith("variant_") || id === orderQuantityField || specIds.has(id)) && fact.eventId !== eventId) delete instance.facts[id];
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
          try {
            const read = await readOrderProduct(state.businessId, id, collectionOnly);
            terms.set(cacheKey, read.terms); bases.set(id, read.basePrice); lists.set(id, read.lists); units.set(id, read.priceUnit); specs.set(id, read.spec);
          } catch { terms.delete(cacheKey); }
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
      const options = Object.fromEntries(definition.steps.flatMap(s => s.kind === "collect" && s.fieldId !== key("productId") && s.fieldId !== orderQuantityField && !["customer_name", "customer_phone", "customer_city", "customer_address", "customer_email"].includes(s.fieldId)
        && instance.facts[s.fieldId] ? [[s.fieldId, instance.facts[s.fieldId].value]] : []));
      const own = variants.get(productId) ?? [];
      // A linked product's optional catalog answers have no question of their own; they go with the order too.
      const spec = specs.get(productId);
      if (spec) for (const id of specFieldIds(spec, own)) if (instance.facts[id] && !Object.hasOwn(options, id)) options[id] = instance.facts[id].value;
      const priced: Partial<OrderTerms> = own.length ? { ...current, unitAmount: variantUnitAmount(own, bases.has(productId) ? bases.get(productId)! : current.unitAmount, chosenOf(instance)) ?? current.unitAmount } : { ...current };
      // Priced per unit: the quantity is the customer's answer; until it is given, there is none to review.
      if (units.get(productId)) {
        const ordered = instance.facts[orderQuantityField]?.value;
        if (validOrderQuantity(ordered)) priced.quantity = ordered; else delete priced.quantity;
      } else priced.quantity = 1;
      return { ...Object.fromEntries(Object.entries(priced).map(([name, value]) => [key(name), value as Value])), [key("options")]: JSON.stringify(options) };
    },
  };
}
