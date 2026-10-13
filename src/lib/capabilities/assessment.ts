import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createServiceSupabase } from "@/lib/supabase/service";
import { capabilityRegistry, getCapability, type CapabilityAssessment, type CapabilityDefinition } from "./registry";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { moduleEnforcementEnabled } from "./enforcement";
import { googleConfigured } from "@/lib/calendar/google";

export type CapabilityAssessmentActor = { userId: string };

type QueryResult = { data: unknown; error: { code?: string } | null };

function statusFor(
  definition: CapabilityDefinition,
  modules: string[],
  requirements: string[],
  evidence: string[],
  extraMissing: string[] = [],
): CapabilityAssessment {
  const missing = [
    ...definition.requiredModules.filter((module) => !modules.includes(module)).map((module) => `module:${module}`),
    ...requirements,
    ...extraMissing,
  ];
  return {
    capabilityKey: definition.key,
    status: missing.length ? "needs_setup" : "ready",
    availability: missing.some(key => key.startsWith("module:")) ? "module_disabled" : missing.length ? "missing_configuration" : "ready",
    reasonCode: missing.some(key => key.startsWith("module:")) ? "module_disabled" : missing.length ? "missing_requirements" : "verified_handler_and_configuration",
    missingRequirements: missing,
    evidence,
  };
}

async function authorizedBusiness(businessId: string, actor: CapabilityAssessmentActor) {
  const db = createServiceSupabase();
  const [membership, admin] = await Promise.all([
    db.from("business_users").select("business_id").eq("business_id", businessId).eq("user_id", actor.userId).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", actor.userId).maybeSingle(),
  ]);
  if (membership.error || admin.error) throw new Error("Nuk u verifikua qasja në biznes.");
  if (!membership.data && !admin.data) throw new Error("Nuk ke qasje në këtë biznes.");
}

async function countActive(db: ReturnType<typeof createServiceSupabase>, table: string, businessId: string, extra: Record<string, unknown> = {}) {
  let query = db.from(table).select("id", { count: "exact", head: true }).eq("business_id", businessId);
  for (const [key, value] of Object.entries(extra)) query = query.eq(key, value);
  const result = await query;
  return result as QueryResult & { count?: number };
}

async function assessKnownCapability(definition: CapabilityDefinition, businessId: string, modules: string[], candidate?: VisualGraph): Promise<CapabilityAssessment> {
  if (definition.requiredModules.some(module => !modules.includes(module))) return statusFor(definition, modules, [], []);
  const db = createServiceSupabase();
  if (definition.key === "business.provision") {
    const r=await db.rpc("can_execute_business_action",{p_business:businessId,p_user:null,p_action:definition.key,p_automated:true});
    if(r.error) return statusFor(definition,modules,[],[],["action_catalog_unavailable"]);
    return statusFor(definition,modules,[],["business.provision: transactional invitation handler"],r.data===true?[]:["business_provision_automation_permission"]);
  }
  if (definition.key === "knowledge.answer") {
    const result = await countActive(db, "knowledge_entries", businessId, { is_active: true });
    if (result.error) throw new Error("Nuk u verifikua konfigurimi i njohurive.");
    return statusFor(definition, modules, [], ["knowledge_entries: active records are queried server-side"], result.count ? [] : ["active_knowledge"]);
  }
  if (["product.search", "product.recommend", "order.prepare"].includes(definition.key)) {
    const result = await countActive(db, "products", businessId, { is_active: true });
    if (result.error) throw new Error("Nuk u verifikua konfigurimi i katalogut.");
    return statusFor(definition, modules, [], ["products: active records are queried server-side"], result.count ? [] : ["active_products"]);
  }
  if (definition.key === "order.status.read") {
    if (candidate?.nodes.some(node => node.kind === "order_status"))
      return statusFor(definition, modules, [], ["candidate contains supported order_status handler; customer ownership is checked at execution"]);
    const workflow = await db.from("visual_workflows").select("enabled,published_version_id").eq("business_id", businessId).maybeSingle();
    if (workflow.error) throw new Error("Nuk u verifikua workflow-i i porosive.");
    let configured = false;
    if (workflow.data?.enabled && workflow.data?.published_version_id) {
      const version = await db.from("visual_workflow_versions").select("graph").eq("business_id", businessId).eq("id", workflow.data.published_version_id).maybeSingle();
      if (version.error) throw new Error("Nuk u verifikua versioni i workflow-it.");
      configured = Boolean((version.data?.graph as { nodes?: { kind?: string }[] } | null)?.nodes?.some((node) => node.kind === "order_status"));
    }
    return statusFor(definition, modules, [], ["order_status: server runtime handler exists", ...(configured ? ["published workflow contains order_status"] : [])], configured ? [] : ["published_order_status_flow"]);
  }
  if (definition.key === "booking.availability.read" || definition.key === "booking.create") {
    const [settings, services] = await Promise.all([
      db.from("business_calendar_settings").select("agent_booking_enabled").eq("business_id", businessId).maybeSingle(),
      countActive(db, "booking_services", businessId, { is_active: true, booking_enabled: true }),
    ]);
    if (settings.error || services.error) throw new Error("Nuk u verifikua konfigurimi i rezervimeve.");
    const missing = [
      ...(settings.data?.agent_booking_enabled ? [] : ["agent_booking_enabled"]),
      ...(services.count ? [] : ["active_bookable_service"]),
    ];
    // Google is optional: local bookings need no external integration. An
    // explicitly connected but incomplete integration must not look ready.
    if (!missing.length && moduleEnforcementEnabled(businessId)) {
      const connection = await db.from("google_calendar_connections").select("connected,calendar_id").eq("business_id", businessId).maybeSingle();
      if (connection.error) throw new Error("Nuk u verifikua konfigurimi i integrimit.");
      if (connection.data?.connected && (!connection.data.calendar_id || !googleConfigured()))
        return { capabilityKey: definition.key, status: "needs_setup", availability: "integration_unavailable", reasonCode: "integration_unavailable", missingRequirements: ["integration:google_calendar"], evidence: ["Only integration configuration was checked; no credentials were read and no live request was made."] };
    }
    return statusFor(definition, modules, [], ["calendar.available_slots: server handler verifies service and time"], missing);
  }
  if (definition.key === "staff.handoff") {
    return statusFor(definition, modules, [], ["visual handoff node and conversation ownership checks are implemented"]);
  }
  return { capabilityKey: definition.key, status: "unsupported", reasonCode: "unknown_capability", missingRequirements: [], safeAlternative: "Kërko një veprim të mbështetur nga Agjenti." };
}

export async function assessBusinessCapabilities(businessId: string, actor: CapabilityAssessmentActor, scope?: { keys: string[]; candidate?: VisualGraph }): Promise<CapabilityAssessment[]> {
  await authorizedBusiness(businessId, actor);
  const profile = await loadDashboardProfile(businessId, { requireExplicit: moduleEnforcementEnabled(businessId) });
  const keys = [...new Set(scope?.keys ?? Object.keys(capabilityRegistry))];
  return Promise.all(keys.map(key => {
    const definition = getCapability(key);
    return definition ? assessKnownCapability(definition, businessId, profile.enabledModules, scope?.candidate)
      : { capabilityKey: key, status: "unsupported" as const, availability: "unsupported" as const, reasonCode: "unknown_capability", missingRequirements: [] };
  }));
}

export async function assessCapability(businessId: string, actor: CapabilityAssessmentActor, capabilityKey: string): Promise<CapabilityAssessment> {
  await authorizedBusiness(businessId, actor);
  const definition = getCapability(capabilityKey);
  if (!definition) return { capabilityKey, status: "unsupported", availability: "unsupported", reasonCode: "unknown_capability", missingRequirements: [], safeAlternative: "Kërko një veprim të mbështetur nga Agjenti." };
  const profile = await loadDashboardProfile(businessId, { requireExplicit: moduleEnforcementEnabled(businessId) });
  return assessKnownCapability(definition, businessId, profile.enabledModules);
}

export function summarizeCapabilityAssessments(assessments: CapabilityAssessment[]) {
  return assessments.map(({ capabilityKey, status, availability, reasonCode, missingRequirements, safeAlternative }) => ({ capabilityKey, status, availability, reasonCode, missingRequirements, ...(safeAlternative ? { safeAlternative } : {}) }));
}
