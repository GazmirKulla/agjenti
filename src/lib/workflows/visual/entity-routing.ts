import { createServiceSupabase } from "@/lib/supabase/service";
import { foldText } from "../engine";
import { matchingCatalogNames } from "@/lib/products/match-name";
import { isBareCollectionValue, isEntityReference, positiveEntityText, referenceEntityKind, resolveProductReference, resolveServiceReference } from "@/lib/products/entity-bridge";
import type { ConversationStatePayload } from "../engine";
import type { VisualGraph, VisualRunState } from "./types";
import { pendingCollectNode } from "./facts";
import { runtimeModules, requireRuntimeModules, moduleEnforcementEnabled } from "@/lib/capabilities/enforcement";

export type VisualEntity = { kind: "product" | "service"; id: string; name: string; productTypeId?: string | null; bookingEnabled?: boolean; price_amount?: number | null; currency?: string | null };
export type VisualEntitySelection = { entity: VisualEntity; binding: NonNullable<VisualRunState["binding"]> };
export function isEntityInformationRequest(message: string) {
  const text = foldText(message);
  return /\b(sa kushton|cmim\w*|price|how much|informacion\w*|information|me thuaj|dua te di)\b/.test(text)
    && !/\b(porosit\w*|rezervo\w*|book|buy|vazhdo\w*|rifillo\w*)\b|\bdua\b.*\b(porosi\w*|rezervim\w*)\b/.test(text);
}
/** Production resolves active entries; isolated preview also permits inactive entries explicitly bound in the graph. */
export async function resolveVisualEntity(businessId: string, graph: VisualGraph, message: string, saved?: VisualRunState["binding"], preview = false, reference?: { state?: ConversationStatePayload | null; selectedProductId?: string; selectedServiceId?: string; deliveredReply?: string | null; draftPreview?: boolean }): Promise<{ selected?: VisualEntitySelection; mentioned?: VisualEntity; choices?: VisualEntity[]; available?: VisualEntity[]; clarification?: string }> {
  // An explicit draft must also recognize unbound products so execution can fail
  // closed. Test mode alone (e.g. Chat Lab with a published graph) is not a draft.
  if (graph.version !== 2 || !reference?.draftPreview && !graph.flows.some(flow => flow.productIds?.length || flow.serviceIds?.length)) return {};
  const modules = await runtimeModules(businessId);
  if (saved) await requireRuntimeModules(businessId, [saved.entity.kind === "product" ? "products" : "services"]);
  const db = createServiceSupabase();
  const all = async <T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await page(offset, offset + 499);
      if (result.error) throw new Error("Nuk u ngarkuan produktet dhe shërbimet e rrjedhës.");
      rows.push(...result.data ?? []);
      if ((result.data?.length ?? 0) < 500) return rows;
    }
  };
  const [products, services] = await Promise.all([
    all((from, to) => modules && !modules.includes("products") ? Promise.resolve({ data: [], error: null }) : db.from("products").select("id,name,sku,product_type_id,price_amount,currency").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
    all((from, to) => modules && !modules.includes("services") ? Promise.resolve({ data: [], error: null }) : db.from("booking_services").select("id,name,booking_enabled").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
  ]);
  const activeProducts = [...products];
  const activeServices = [...services];
  if (preview && !moduleEnforcementEnabled(businessId)) {
    const boundProducts = [...new Set(graph.flows.flatMap(flow => flow.productIds ?? []))];
    const boundServices = [...new Set(graph.flows.flatMap(flow => flow.serviceIds ?? []))];
    const inactive = async <T>(ids: string[], query: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
      const rows: T[] = [];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const result = await query(ids.slice(offset, offset + 200));
        if (result.error) throw new Error("Nuk u ngarkuan produktet dhe shërbimet e rrjedhës.");
        rows.push(...result.data ?? []);
      }
      return rows;
    };
    const [previewProducts, previewServices] = await Promise.all([
      inactive(modules && !modules.includes("products") ? [] : boundProducts, ids => db.from("products").select("id,name,sku,product_type_id,price_amount,currency").eq("business_id", businessId).eq("is_active", false).in("id", ids)),
      inactive(modules && !modules.includes("services") ? [] : boundServices, ids => db.from("booking_services").select("id,name,booking_enabled").eq("business_id", businessId).eq("is_active", false).in("id", ids)),
    ]);
    products.push(...previewProducts); services.push(...previewServices);
  }
  const entities: (VisualEntity & { sku?: string | null })[] = [
    ...(products ?? []).map(row => ({ kind: "product" as const, id: row.id, name: row.name, sku: row.sku, productTypeId: row.product_type_id, price_amount: row.price_amount, currency: row.currency })),
    ...(services ?? []).map(row => ({ kind: "service" as const, id: row.id, name: row.name, bookingEnabled: row.booking_enabled })),
  ];
  const available = entities.filter(entity => graph.flows.some(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id)));
  const text = foldText(message);
  const pending = pendingCollectNode(graph, reference?.state?.visual);
  const collectingField = pending ? pending.config.fieldType ?? "text" : undefined;
  const fieldValue = !reference?.selectedProductId && !reference?.selectedServiceId && isBareCollectionValue(message, collectingField, entities);
  const skuMatches = fieldValue ? [] : entities.filter(entity => {
    const sku = entity.sku ? foldText(entity.sku) : "";
    return Boolean(sku && (text === sku || text === `sku ${sku}`));
  });
  const serviceReference = reference?.selectedServiceId || !reference?.selectedProductId && referenceEntityKind(message, reference?.state) === "service";
  const serviceResult = serviceReference && (reference?.selectedServiceId || isEntityReference(message)) ? resolveServiceReference({ businessId, message, services: activeServices,
    state: reference?.state, verifiedId: reference?.selectedServiceId, deliveredReply: reference?.deliveredReply, mode: preview ? "test" : "production", collectingField }) : null;
  if (serviceResult?.status === "clarify") return { clarification: serviceResult.reply, available };
  const resolved = !serviceReference && (reference?.selectedProductId || isEntityReference(message)) ? resolveProductReference({ businessId, message, products: activeProducts,
    state: reference?.state, verifiedId: reference?.selectedProductId, deliveredReply: reference?.deliveredReply, mode: preview ? "test" : "production", collectingField }) : null;
  if (resolved?.status === "clarify") return { clarification: resolved.reply, available };
  const positive = positiveEntityText(message);
  const named = fieldValue ? [] : skuMatches.length ? skuMatches : matchingCatalogNames(entities, positive.text);
  // A product-only lookup must not suppress an equally named service in the
  // existing visual router. Relative references already identify the entity kind.
  if (resolved?.status === "selected" && named.some(entity => entity.kind === "service")
    && named.some(entity => entity.kind === "product" && entity.id === resolved.product.id)) return { choices: named, available };
  const mentioned = serviceResult?.status === "selected" ? entities.filter(entity => entity.kind === "service" && entity.id === serviceResult.service.id)
    : resolved?.status === "selected" ? entities.filter(entity => entity.kind === "product" && entity.id === resolved.product.id)
    : named;
  const canonicalId = saved?.entity.kind === "product" && reference?.state?.context?.execution.factOwner === "order"
    ? reference.state.product_id ?? saved.entity.id : saved?.entity.id;
  const candidates = mentioned.length ? mentioned : saved ? entities.filter(entity => entity.kind === saved.entity.kind && entity.id === canonicalId) : [];
  if (candidates.length > 1) return { choices: candidates, available };
  const entity = candidates[0];
  if (!entity) return { available };
  const flow = graph.flows.find(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id));
  return flow ? { selected: { entity, binding: { flowId: flow.id, entity: { kind: entity.kind, id: entity.id } } }, mentioned: mentioned[0], available } : { available, mentioned: mentioned[0] };
}
