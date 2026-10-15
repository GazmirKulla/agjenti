import { createServiceSupabase } from "@/lib/supabase/service";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { assessBusinessCapabilities } from "./assessment";
import { graphRequirements } from "./graph";
import { capabilityModules, CapabilityEnforcementError, moduleEnforcementEnabled, requireRuntimeModules } from "./enforcement";
import type { CapabilityAssessment } from "./registry";
import { capabilityFinding, readinessFinding } from "./diagnostics";

/** Only whitelisted IDs/activity flags are read. Absent and foreign IDs have the same response. */
export async function requireActiveBindings(businessId: string, productIds: string[], serviceIds: string[]) {
  return requireOwnedBindings(businessId, productIds, serviceIds, true);
}

/** Draft references prove ownership, not runtime readiness. Publishing still requires activity. */
export async function requireOwnedBindings(businessId: string, productIds: string[], serviceIds: string[], activeOnly = false) {
  const db = createServiceSupabase();
  for (const [table, ids] of [["products", productIds], ["booking_services", serviceIds]] as const) {
    const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 200) {
      const requested = unique.slice(offset, offset + 200);
      let query = db.from(table).select("id").eq("business_id", businessId).in("id", requested);
      if (activeOnly) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error || requested.some(id => !data?.some(row => row.id === id)))
        throw new CapabilityEnforcementError("binding_unavailable", activeOnly ? "Një produkt ose shërbim i lidhur nuk është aktiv në këtë biznes. Kontrollo lidhjet e rrjedhës." : "Një produkt ose shërbim i lidhur nuk gjendet në këtë biznes. Kontrollo lidhjet e draftit.");
    }
  }
}

/** New policy is opt-in per tenant; simulation and confirmation rules remain separate and unchanged. */
export async function enforceWorkflowCapabilities(businessId: string, userId: string, graph: VisualGraph, operation: "draft" | "publish" | "enable"): Promise<CapabilityAssessment[] | undefined> {
  if (!moduleEnforcementEnabled(businessId)) return undefined;
  const required = graphRequirements(graph);
  // Assessment authorizes the actor even when the graph has no business actions.
  let assessments: CapabilityAssessment[];
  try { assessments = await assessBusinessCapabilities(businessId, { userId }, { keys: required.capabilityKeys, candidate: graph }); }
  catch { throw new CapabilityEnforcementError("unverified", "Nuk u verifikuan qasja dhe aftësitë e biznesit. Provo përsëri."); }
  if (required.capabilityKeys.some(key => !assessments.some(item => item.capabilityKey === key)))
    throw new CapabilityEnforcementError("unverified", "Vlerësimi i aftësive është i paplotë. Provo përsëri.");
  for (const capability of assessments) {
    const disabled = capability.availability === "module_disabled" || capability.missingRequirements.some(key => key.startsWith("module:"));
    if (disabled || capability.status === "unsupported" || capability.status === "needs_clarification" || operation !== "draft" && capability.status !== "ready")
      throw new CapabilityEnforcementError(disabled ? "module_disabled" : capability.availability ?? "missing_configuration",
        disabled ? "Një modul i kërkuar nga rrjedha është i çaktivizuar." : "Aftësitë e rrjedhës nuk janë gati. Kontrollo konfigurimin para aktivizimit.",
        assessments.filter(c => c.status !== "ready").map(c => capabilityFinding(c, graph)));
  }
  await requireRuntimeModules(businessId, required.modules);
  try { await requireOwnedBindings(businessId, required.productIds, required.serviceIds, operation !== "draft"); }
  catch (error) {
    if (!(error instanceof CapabilityEnforcementError)) throw error;
    throw new CapabilityEnforcementError(error.code, error.message, [readinessFinding(error.code, error.message, {
      missingRequirements: [operation === "draft" ? "tenant_owned_bindings" : "active_tenant_bindings"],
      affectedNodeIds: graph.version === 2 ? graph.flows.filter(f => f.productIds?.length || f.serviceIds?.length).flatMap(f => f.nodeIds) : [],
      remediation: operation === "draft" ? "Zgjidh vetëm produkte/shërbime të këtij biznesi; hiq referencat që mungojnë." : "Aktivizo produktet/shërbimet e lidhura në këtë biznes ose hiqi nga rrjedha para publikimit.",
    })]);
  }
  return assessments;
}

/** Authoring legacy definitions checks catalog/modules, not a pre-existing order
 * workflow (which would recreate the bootstrap cycle). Execution is checked separately. */
export async function enforceOrderWorkflow(businessId: string, userId: string, productIds: string[]) {
  if (!moduleEnforcementEnabled(businessId)) return;
  const assessments = await assessBusinessCapabilities(businessId, { userId }, { keys: ["product.search"] });
  await requireRuntimeModules(businessId, capabilityModules(["order.prepare"]));
  await requireActiveBindings(businessId, productIds, []);
  if (assessments[0]?.status !== "ready") throw new CapabilityEnforcementError("missing_configuration", "Konfiguro produkte aktive para lidhjes së procesit të porosisë.");
}
