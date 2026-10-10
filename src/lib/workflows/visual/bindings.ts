import { createServiceSupabase } from "@/lib/supabase/service";
import { loadVisualVersion } from "./store";
import type { VisualGraph } from "./types";

type BoundFlow = { flowId: string; flowLabel: string };
export type BindingProduct = { id: string; name: string; isActive: boolean };
export type BindingService = BindingProduct & { bookingEnabled: boolean };
export type VisualBindingCatalog = { products: BindingProduct[]; services: BindingService[] };
export type VisualBindings = {
  versionId: string | null;
  enabled: boolean;
  products: (BindingProduct & BoundFlow)[];
  services: (BindingService & BoundFlow)[];
};

/** Names and ownership come from the tenant's catalog, never from model-supplied labels. */
export async function loadVisualBindingCatalog(businessId: string, graphs: VisualGraph[]): Promise<VisualBindingCatalog> {
  const flows = graphs.flatMap(graph => graph.version === 2 ? graph.flows : []);
  const productIds = [...new Set(flows.flatMap(flow => flow.productIds ?? []))];
  const serviceIds = [...new Set(flows.flatMap(flow => flow.serviceIds ?? []))];
  const db = createServiceSupabase();
  const products: BindingProduct[] = [], services: BindingService[] = [];
  for (const [table, ids, columns] of [
    ["products", productIds, "id,name,is_active"],
    ["booking_services", serviceIds, "id,name,is_active,booking_enabled"],
  ] as const) {
    // Bound each URL even when several flows together reference a large catalog.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const { data, error } = await db.from(table).select(columns).eq("business_id", businessId).in("id", ids.slice(offset, offset + 200));
      if (error) throw new Error("Nuk u lexuan lidhjet me produktet dhe shërbimet.");
      // Both explicit column lists share these fields; Supabase cannot infer a
      // select parser result from the union of table/column pairs above.
      const rows = (data ?? []) as unknown as { id: string; name: string; is_active: boolean; booking_enabled?: boolean }[];
      for (const row of rows) {
        const item = { id: String(row.id), name: String(row.name), isActive: Boolean(row.is_active) };
        if (table === "products") products.push(item);
        else services.push({ ...item, bookingEnabled: Boolean("booking_enabled" in row && row.booking_enabled) });
      }
    }
  }
  return { products, services };
}

/** Published assignments only; disabled publications remain inspectable but are not effective. */
export async function loadVisualBindings(businessId: string): Promise<VisualBindings> {
  const { data, error } = await createServiceSupabase().from("visual_workflows")
    .select("published_version_id,enabled").eq("business_id", businessId).maybeSingle();
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error("Nuk u lexuan lidhjet e rrjedhës aktive.");
  if (!data?.published_version_id) return { versionId: null, enabled: false, products: [], services: [] };
  const version = await loadVisualVersion(businessId, data.published_version_id);
  if (!version) throw new Error("Versioni i publikuar nuk u gjet.");
  const catalog = await loadVisualBindingCatalog(businessId, [version.graph]);
  const flows = version.graph.version === 2 ? version.graph.flows : [];
  return {
    versionId: version.id, enabled: Boolean(data.enabled),
    products: catalog.products.flatMap(product => {
      const flow = flows.find(flow => flow.productIds?.includes(product.id));
      return flow ? [{ ...product, flowId: flow.id, flowLabel: flow.label }] : [];
    }),
    services: catalog.services.flatMap(service => {
      const flow = flows.find(flow => flow.serviceIds?.includes(service.id));
      return flow ? [{ ...service, flowId: flow.id, flowLabel: flow.label }] : [];
    }),
  };
}
