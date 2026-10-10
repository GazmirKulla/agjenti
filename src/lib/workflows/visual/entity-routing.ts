import { createServiceSupabase } from "@/lib/supabase/service";
import { foldText } from "../engine";
import type { VisualGraph, VisualRunState } from "./types";

export type VisualEntity = { kind: "product" | "service"; id: string; name: string; productTypeId?: string | null; bookingEnabled?: boolean };
export type VisualEntitySelection = { entity: VisualEntity; binding: NonNullable<VisualRunState["binding"]> };
export function isEntityInformationRequest(message: string) {
  const text = foldText(message);
  return /\b(sa kushton|cmim\w*|price|how much|informacion\w*|information|me thuaj|dua te di)\b/.test(text)
    && !/\b(porosit\w*|rezervo\w*|book|buy|vazhdo\w*|rifillo\w*)\b|\bdua\b.*\b(porosi\w*|rezervim\w*)\b/.test(text);
}
/** Resolve only active tenant catalog entries. Graph IDs and model guesses cannot supply entity data. */
export async function resolveVisualEntity(businessId: string, graph: VisualGraph, message: string, saved?: VisualRunState["binding"]): Promise<{ selected?: VisualEntitySelection; mentioned?: VisualEntity; choices?: VisualEntity[]; available?: VisualEntity[] }> {
  if (graph.version !== 2 || !graph.flows.some(flow => flow.productIds?.length || flow.serviceIds?.length)) return {};
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
    all((from, to) => db.from("products").select("id,name,sku,product_type_id").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
    all((from, to) => db.from("booking_services").select("id,name,booking_enabled").eq("business_id", businessId).eq("is_active", true).order("id").range(from, to)),
  ]);
  const entities: (VisualEntity & { sku?: string | null })[] = [
    ...(products ?? []).map(row => ({ kind: "product" as const, id: row.id, name: row.name, sku: row.sku, productTypeId: row.product_type_id })),
    ...(services ?? []).map(row => ({ kind: "service" as const, id: row.id, name: row.name, bookingEnabled: row.booking_enabled })),
  ];
  const available = entities.filter(entity => graph.flows.some(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id)));
  const text = foldText(message);
  const mentioned = entities.filter(entity => {
    const name = foldText(entity.name);
    const sku = entity.sku ? foldText(entity.sku) : "";
    return text === name || Boolean(sku && (text === sku || text === `sku ${sku}`)) || name.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(text);
  });
  const candidates = mentioned.length ? mentioned : saved ? entities.filter(entity => entity.kind === saved.entity.kind && entity.id === saved.entity.id) : [];
  if (candidates.length > 1) return { choices: candidates, available };
  const entity = candidates[0];
  if (!entity) return { available };
  const flow = graph.flows.find(flow => (entity.kind === "product" ? flow.productIds : flow.serviceIds)?.includes(entity.id));
  return flow ? { selected: { entity, binding: { flowId: flow.id, entity: { kind: entity.kind, id: entity.id } } }, mentioned: mentioned[0], available } : { available, mentioned: mentioned[0] };
}
