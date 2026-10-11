import { loadVisualVersion } from "./store";

export type BusinessWorkflow = { name: string; active: boolean; status: string };

/** The business owns one visual workflow. Catalog products inherit it; branches are optional overrides. */
export async function publishedBusinessWorkflow(businessId: string): Promise<BusinessWorkflow | null> {
  const version = await loadVisualVersion(businessId);
  return version ? { name: version.graph.name, active: true, status: "Aktiv" } : null;
}
