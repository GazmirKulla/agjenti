import { loadVisualVersion } from "./store";
import { automaticStatus, type AutomaticReadiness } from "@/lib/orchestration/automatic-process";

/** The business's workflow as the product pages show it. `automatic`: built by the server from the modules, with what it can do now. */
export type BusinessWorkflow = { name: string; active: boolean; status: string; automatic?: { readiness: AutomaticReadiness[] } };

/** The owner's process when it is a status card's status, for a business without one the automatic process. */
export function automaticBusinessWorkflow(status: { readiness: AutomaticReadiness[]; active: boolean }): BusinessWorkflow {
  const orders = status.readiness.find(r => r.capability === "orders")?.ready ?? false;
  return { name: "Agjenti automatik", active: orders, status: orders ? "Merr porosi" : status.active ? "Aktiv pa porosi" : "Jo gati", automatic: { readiness: status.readiness } };
}

/** The business owns one visual workflow. Catalog products inherit it; branches are optional overrides. */
export async function publishedBusinessWorkflow(businessId: string): Promise<BusinessWorkflow | null> {
  const version = await loadVisualVersion(businessId);
  if (version) return { name: version.graph.name, active: true, status: "Aktiv" };
  const automatic = await automaticStatus(businessId);
  return automatic ? automaticBusinessWorkflow(automatic) : null;
}
