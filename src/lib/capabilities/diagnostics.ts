import type { CapabilityAssessment } from "./registry";
import { nodeCapabilityKeys, flowCapabilityKeys, unsupportedRequestKeys } from "./graph";
import type { VisualGraph } from "@/lib/workflows/visual/types";

export type ReadinessFinding = {
  code: string; message: string; nodeId?: string;
  /** Null means a graph/deployment/execution check, not a specific capability. */
  capabilityKey?: string | null;
  reasonCode?: string;
  missingRequirements?: string[];
  affectedNodeIds?: string[];
  remediation?: string;
};
const requirements: Record<string, string> = {
  active_products: "Shto ose aktivizo produkte me çmim, monedhë dhe lloj të vlefshëm në katalog.",
  active_knowledge: "Shto ose aktivizo njohuritë e biznesit.",
  candidate_order_flow: "Konfiguro një rrjedhë porosie në draftin që po shqyrton.",
  published_order_flow: "Konfiguro, provo dhe publiko një rrjedhë porosie; katalogu aktiv nuk e aktivizon porositjen.",
  published_order_status_flow: "Shto hapin e statusit të porosisë në workflow dhe publikoje pas verifikimit.",
  agent_booking_enabled: "Aktivizo rezervimet e agjentit te konfigurimi i rezervimeve.",
  active_bookable_service: "Aktivizo një shërbim me rezervim dhe konfiguro oraret e tij.",
  "integration:google_calendar": "Verifiko lidhjen dhe kalendarin e zgjedhur; mos dërgo kredenciale në chat.",
  business_provision_automation_permission: "Kontrollo lejet për krijimin automatik të biznesit.",
  action_catalog_unavailable: "Verifiko disponueshmërinë e katalogut të veprimeve në server.",
  capability_assessment: "Riprovo vlerësimin pasi të verifikohen qasja dhe konfigurimi i biznesit.",
};
const moduleKeys = new Set(["products", "orders", "workflows", "knowledge", "bookings", "services", "staff"]);
const remediations: Record<string, string> = {
  unauthorized: "Rihyr dhe kërko qasje në biznesin përkatës; mos përdor miratim nga një tenant tjetër.",
  stale_revision: "Rifresko draftin dhe gjenero përsëri propozimin, simulimin dhe miratimin.",
  snapshot_changed: "Rifresko draftin/versionin e publikuar dhe përsërit shqyrtimin.",
  approval_mismatch: "Kërko miratim të ri për graf-in dhe revision-in aktual.",
  invalid_graph: "Korrigjo hapat dhe lidhjet e shënuara nga validimi, pastaj përsërit provën.",
  unsupported_graph_action: "Hiq konfigurimin e veprimit të pambështetur dhe përdor vetëm hapat e motorit ekzistues.",
  assessment_unavailable: "Kontrollo sesionin, anëtarësimin dhe leximin e konfigurimit; pastaj rivlerëso capability-t.",
  clarification_required: "Përgjigju pyetjeve të sqarimit para gjenerimit të propozimit të ri.",
  simulation_mismatch: "Ekzekuto një simulim të ri për këtë graf, propozim dhe revision.",
  simulation_failed: "Hap skenarët FAIL, korrigjo hapat e prekur dhe përsërit simulimin.",
  simulation_blocked: "Plotëso kërkesat e skenarëve BLOCKED dhe përsërit simulimin.",
  simulation_unverified: "Siguro evidencë të izoluar për skenarët kritikë UNVERIFIED; mungesa e provës nuk është PASS.",
  scenario_budget: "Ndaje ndryshimin në propozime më të vogla dhe përsërit mbulimin e skenarëve.",
  time_budget: "Përsërit provën ose zvogëlo ndryshimin; kufiri kohor nuk konfirmon sjelljen.",
  hub_unverified: "Provo zgjedhjen e procesit dhe lidhjet e katalogut në preview të izoluar me tenant-in dhe versionin e saktë.",
  baseline_unverified: "Verifiko fillimisht sjelljen e versionit bazë me një provë të izoluar, pastaj krahaso kandidatin.",
  write_unconfirmed: "Rifresko historikun e versioneve përpara çdo riprovimi; mungesa e përgjigjes nuk provon nëse publikimi u krye.",
};
export function readinessFinding(code: string, message: string, extra: Partial<ReadinessFinding> = {}): ReadinessFinding {
  return { code, message, capabilityKey: null, reasonCode: code, missingRequirements: [], affectedNodeIds: extra.nodeId ? [extra.nodeId] : [],
    remediation: remediations[code] ?? "Kontrollo këtë kërkesë dhe përsërit verifikimin para publikimit.", ...extra };
}
export function capabilityFinding(capability: CapabilityAssessment, graph?: VisualGraph): ReadinessFinding {
  // Only public identifiers, never evidence, integration values or model prose.
  const key = /^[a-z][a-z0-9_.]{0,80}$/.test(capability.capabilityKey) ? capability.capabilityKey : "unknown_capability";
  const missing = (capability.missingRequirements ?? []).map(r => Object.hasOwn(requirements, r) || r.startsWith("module:") && moduleKeys.has(r.slice(7)) ? r : "configuration_review_required");
  const unsupported = capability.status === "unsupported";
  const affected = graph ? [...new Set([
    ...graph.nodes.filter(n => nodeCapabilityKeys(n).includes(key) || unsupportedRequestKeys(`${n.label} ${n.config.prompt ?? ""} ${n.config.fieldKey ?? ""} ${n.config.value ?? ""}`).includes(key)).map(n => n.id),
    ...(graph.version === 2 ? graph.flows.filter(f => flowCapabilityKeys(f).includes(key)).flatMap(f => f.nodeIds) : []),
  ])] : [];
  return readinessFinding(unsupported ? "unsupported_capability" : "capability_not_ready", `${key} → ${missing.join(", ") || (unsupported ? "Aftësi e pambështetur" : "Kërkohet verifikim")}`, {
    capabilityKey: key, reasonCode: /^[a-z_]{1,80}$/.test(capability.reasonCode) ? capability.reasonCode : "assessment_unavailable",
    missingRequirements: [...new Set(missing)], affectedNodeIds: affected,
    remediation: unsupported ? "Hiqe veprimin e pambështetur ose zgjidh një capability me ekzekutues ekzistues. Nuk do të ekzekutohet." :
      missing.length ? [...new Set(missing.map(r => requirements[r] ?? (r.startsWith("module:") ? `Aktivizo modulin ${r.slice(7)} nëse lejohet nga paketa dhe roli yt.` : "Rishiko konfigurimin me administratorin.")))].join(" ") :
        "Sqaro kërkesën ose përsërit vlerësimin; ky rezultat nuk autorizon veprime.",
  });
}
