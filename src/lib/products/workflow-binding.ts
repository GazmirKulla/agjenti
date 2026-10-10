import { loadVisualBindings } from "@/lib/workflows/visual/bindings";
import type { ProductRow } from "./catalog";

/** Only published, enabled assignments can satisfy product activation. */
export async function publishedProductBindings(businessId: string): Promise<Map<string, NonNullable<ProductRow["visual_workflow"]>>> {
  const bindings = await loadVisualBindings(businessId);
  if (!bindings.enabled || !bindings.versionId) return new Map();
  return new Map(bindings.products.map(product => [product.id, { versionId: bindings.versionId!, flowId: product.flowId, name: product.flowLabel }]));
}
