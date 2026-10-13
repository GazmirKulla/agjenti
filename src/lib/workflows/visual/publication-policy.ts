import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { visualGraphHash } from "./graph-hash";
import { matchesSimulationBinding } from "./simulation";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";
import { getCapability } from "@/lib/capabilities/registry";
import type { VisualGraph } from "./types";
import type { SimulationReport } from "./simulation-types";
import type { PublicationApproval, PublicationReadiness } from "./publication-types";

/** Server policy, not an authorization API. Evidence and identities MUST be loaded on the server. */
export function evaluatePublicationPolicy(p: {
  mode: PublicationReadiness["mode"]; businessId: string; userId: string; authorized: boolean;
  revision: number; candidate: unknown; runtimeBlockers?: string[];
  currentRevision?: number; currentDraft?: VisualGraph; publishedVersionId?: string | null;
  expectedPublishedVersionId?: string | null; ownedVersion?: boolean;
  proposalId?: string; requestId?: string; approval?: PublicationApproval; confirming?: boolean;
  capabilities?: CapabilityAssessment[]; assessmentUnavailable?: boolean; simulation?: SimulationReport;
}): PublicationReadiness {
  const graph = normalizeVisualDraft(p.candidate), hash = graph ? visualGraphHash(graph) : null;
  const result: PublicationReadiness = { mode: p.mode, result: "PASS", status: "ready", canRequestApproval: false, canPublish: false,
    baseRevision: p.revision, candidateGraphHash: hash, findings: [] };
  const block = (status: PublicationReadiness["status"], code: string, message: string, state: PublicationReadiness["result"] = "BLOCKED") => {
    result.status = status; result.result = state; result.findings.push({ code, message }); return result;
  };
  if (!p.authorized || p.ownedVersion === false) return block("blocked", "unauthorized", "Nuk u verifikua qasja ose pronësia e workflow-it në këtë biznes.");
  if (!Number.isInteger(p.revision) || p.revision < 0 || p.currentRevision !== undefined && p.revision !== p.currentRevision)
    return block("stale_proposal", "stale_revision", "Rrjedha ndryshoi në një dritare tjetër. Rifresko dhe përgatite propozimin përsëri.");
  if (!graph || !validateVisualGraph(p.candidate).graph) return block("blocked", "invalid_graph", "Plotëso hapat dhe lidhjet e shënuara para publikimit.", "FAIL");
  if (p.runtimeBlockers?.length) return block("needs_setup", "runtime_not_ready", `Ruaje si draft dhe provoje. Para aktivizimit: ${p.runtimeBlockers.join(" ")}`);
  if (p.mode === "manual_legacy") {
    // Deliberate compatibility exception: never relabel absent simulation as PASS.
    result.result = "UNVERIFIED"; result.status = "unverified_external_action"; result.canPublish = true;
    result.findings.push({ code: "manual_compatibility", message: "Publikim manual sipas kontrolleve ekzistuese. Aftësitë dhe skenarët e jashtëm nuk janë validuar nga simulimi automatik; kjo nuk është PASS." });
    return result;
  }
  if (p.currentRevision === undefined || !p.currentDraft || visualGraphHash(normalizeVisualDraft(p.currentDraft)!) !== hash ||
      p.expectedPublishedVersionId !== undefined && p.expectedPublishedVersionId !== (p.publishedVersionId ?? null))
    return block("stale_proposal", "snapshot_changed", "Grafi ose versioni i publikuar ndryshoi. Përgatite propozimin përsëri.");
  if (p.assessmentUnavailable || !p.capabilities) return block("blocked", "assessment_unavailable", "Nuk u verifikuan aftësitë dhe qasja në biznes. Provo përsëri.");
  if (p.capabilities.some(c => !getCapability(c.capabilityKey) || c.status === "unsupported"))
    return block("blocked", "unsupported_capability", "Propozimi përmban veprime që nuk mbështeten. Nuk mund të publikohen si automatizim.");
  if (p.capabilities.some(c => c.status !== "ready")) return block("needs_setup", "capability_not_ready", "Aftësitë ose konfigurimi nuk janë gati. Plotëso konfigurimin dhe kontrollo propozimin përsëri.");
  const simulation = p.simulation;
  if (!simulation || !p.proposalId || !matchesSimulationBinding(simulation, p.proposalId, p.revision, graph))
    return block("stale_proposal", "simulation_mismatch", "Simulimi nuk i përket këtij grafi ose revisioni. Përgatite propozimin përsëri.");
  const critical = simulation.scenarios.filter(s => s.critical);
  if (simulation.result === "FAIL" || critical.some(s => s.result === "FAIL")) return block("simulation_failed", "simulation_failed", "Simulimi dështoi. Kontrollo skenarët dhe hapat e shënuar.", "FAIL");
  if (simulation.result === "BLOCKED" || critical.some(s => s.result === "BLOCKED")) return block("blocked", "simulation_blocked", "Simulimi është i bllokuar. Plotëso kërkesat përpara publikimit.");
  if (!critical.length || simulation.result !== "PASS" || !simulation.canPublish || critical.some(s => s.result !== "PASS" || s.executionCount < 1))
    return block("unverified_external_action", "simulation_unverified", "Simulimi nuk provoi të gjithë skenarët kritikë. Veprimet e jashtme ose të paverifikuara nuk lejojnë publikim nga asistenti.", "UNVERIFIED");
  if (!p.confirming) {
    result.status = "approval_required"; result.canRequestApproval = true;
    result.findings.push({ code: "approval_required", message: "Gati për publikim sipas kontrolleve lokale. Kërkohet miratimi yt; ende nuk është publikuar." }); return result;
  }
  const a = p.approval;
  if (!a || a.businessId !== p.businessId || a.userId !== p.userId || !p.requestId || a.requestId !== p.requestId || !Number.isFinite(a.expires) || a.expires <= Date.now() ||
      a.publishedVersionId !== (p.publishedVersionId ?? null) || !matchesSimulationBinding(a, p.proposalId, p.revision, graph))
    return block("stale_proposal", "approval_mismatch", "Miratimi ka skaduar ose nuk i përket këtij propozimi, grafi dhe biznesi. Përgatite përsëri.");
  result.canPublish = true; return result;
}
