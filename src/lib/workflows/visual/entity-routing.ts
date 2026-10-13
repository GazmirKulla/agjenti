import { createServiceSupabase } from "@/lib/supabase/service";
import { foldText } from "../engine";
import { matchingCatalogNames } from "@/lib/products/match-name";
import type { VisualGraph, VisualRunState } from "./types";
import { runtimeModules, requireRuntimeModules } from "@/lib/capabilities/enforcement";

export type VisualEntity = { kind: "product" | "service"; id: string; name: string; productTypeId?: string | null; bookingEnabled?: boolean };
export type VisualEntitySelection = { entity: VisualEntity; binding: NonNullable<VisualRunState["binding"]> };
export function isEntityInformationRequest(message: string) {
  const text = foldText(message);
  return /\b(sa kushton|cmim\w*|price|how much|informacion\w*|information|me thuaj|dua te di)\b/.test(text)
    && !/\b(porosit\w*|rezervo\w*|book|buy|vazhdo\w*|rifillo\w*)\b|\bdua\b.*\b(porosi\w*|rezervim\w*)\b/.test(text);
}
/** Production resolves active entries; isolated preview also permits inactive entries explicitly bound in the graph. */
export async function resolveVisualEntity(businessId: string, graph: VisualGraph, message: string, saved?: VisualRunState["binding"], preview = false): Promise<{ selected?: VisualEntitySelection; mentioned?: VisualEntity; choices?: VisualEntity[]; available?: VisualEntity[] }> {
  if (graph.version !== 2 || !graph.flows.some(flow => flow.productIds?.length || flow.serviceIds?.length)) return {};
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
    all((from, to) => modules && !modules.includes("products") ? Promise.resolve({ data: [], error: null }) : db.from("products").select("id,name,sku,product_type_id").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
    all((from, to) => modules && !modules.includes("services") ? Promise.resolve({ data: [], error: null }) : db.from("booking_services").select("id,name,booking_enabled").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
  ]);
  if (preview && !modules) {
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
      inactive(boundProducts, ids => db.from("products").select("id,name,sku,product_type_id").eq("business_id", businessId).eq("is_active", false).in("id", ids)),
      inactive(boundServices, ids => db.from("booking_services").select("id,name,booking_enabled").eq("business_id", businessId).eq("is_active", false).in("id", ids)),
    ]);
    products.push(...previewProducts); services.push(...previewServices);
  }
  const entities: (VisualEntity & { sku?: string | null })[] = [
    ...(products ?? []).map(row => ({ kind: "product" as const, id: row.id, name: row.name, sku: row.sku, productTypeId: row.product_type_id })),
    ...(services ?? []).map(row => ({ kind: "service" as const, id: row.id, name: row.name, bookingEnabled: row.booking_enabled })),
  ];
  const available = entities.filter(entity => graph.flows.some(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id)));
  const text = foldText(message);
  const skuMatches = entities.filter(entity => {
    const sku = entity.sku ? foldText(entity.sku) : "";
    return Boolean(sku && (text === sku || text === `sku ${sku}`));
  });
  const mentioned = skuMatches.length ? skuMatches : matchingCatalogNames(entities, message);
  const candidates = mentioned.length ? mentioned : saved ? entities.filter(entity => entity.kind === saved.entity.kind && entity.id === saved.entity.id) : [];
  if (candidates.length > 1) return { choices: candidates, available };
  const entity = candidates[0];
  if (!entity) return { available };
  const flow = graph.flows.find(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id));
  return flow ? { selected: { entity, binding: { flowId: flow.id, entity: { kind: entity.kind, id: entity.id } } }, mentioned: mentioned[0], available } : { available, mentioned: mentioned[0] };
}
