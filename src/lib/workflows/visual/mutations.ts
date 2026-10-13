import { requireActionAccess } from "@/lib/actions/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { enforceWorkflowCapabilities } from "@/lib/capabilities/workflow";
import { CapabilityEnforcementError, moduleEnforcementEnabled } from "@/lib/capabilities/enforcement";
import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { loadWorkflowReadiness } from "../readiness";
import { loadVisualVersion, loadVisualWorkspace } from "./store";
import { unconfirmedSaveMessage, type VisualSaveResult } from "./save-result";
import { evaluatePublicationPolicy } from "./publication-policy";
import { reviewWorkflowPublication } from "./publication-service";
import type { PublicationApproval, PublicationReadiness, PublicationReceipt } from "./publication-types";

export type WorkflowOperation = "draft" | "publish" | "enable" | "disable";
/** Caller supplies server-verified identities. The RPC rechecks membership and revision atomically. */
export async function writeVisualWorkflow(
  businessId: string,
  userId: string,
  revision: number,
  raw: unknown,
  operation: WorkflowOperation,
  requestId?: string,
  approval?: PublicationApproval,
): Promise<VisualSaveResult> {
  if (!Number.isInteger(revision) || revision < 0)
    return { error: "Rifresko faqen dhe provo përsëri." };
  const graph =
    operation === "draft"
      ? normalizeVisualDraft(raw)
      : operation === "publish"
        ? validateVisualGraph(raw).graph
        : null;
  if (["draft", "publish"].includes(operation) && !graph)
    return {
      error: "Kontrollo hapat e shënuar.",
      errors: validateVisualGraph(raw).errors,
    };
  let activationGraph = graph;
  let publication: PublicationReadiness | undefined;
  if (operation === "enable") {
    const workspace = await loadVisualWorkspace(businessId);
    activationGraph = workspace.publishedVersionId
      ? (await loadVisualVersion(businessId, workspace.publishedVersionId))?.graph ?? null
      : null;
  }
  let capabilities;
  if (operation === "enable" && !activationGraph && moduleEnforcementEnabled(businessId))
    return { error: "Nuk u verifikua versioni i publikuar. Riaktivizimi nuk u krye." };
  if (operation !== "disable" && activationGraph) {
    try { capabilities = await enforceWorkflowCapabilities(businessId, userId, activationGraph, operation); }
    catch (error) {
      const failure = error instanceof CapabilityEnforcementError ? error : new CapabilityEnforcementError("unverified", "Nuk u verifikuan aftësitë e biznesit.");
      return { error: failure.message, publication: { mode: requestId ? "assistant_strict" : "manual_legacy", result: failure.code === "unverified" ? "UNVERIFIED" : "BLOCKED", status: ["unverified", "unsupported"].includes(failure.code) ? "blocked" : "needs_setup", canPublish: false, canRequestApproval: false, baseRevision: revision, candidateGraphHash: null, findings: [{ code: failure.code, message: failure.message }] } };
    }
  }
  if (operation === "publish" && graph && requestId) {
    const reviewed = await reviewWorkflowPublication({ businessId, userId, revision, graph,
      proposalId: approval?.proposalId ?? requestId, requestId, approval, confirming: true,
      expectedPublishedVersionId: approval?.publishedVersionId });
    publication = reviewed.publication;
    if (!publication.canPublish) return { error: publication.findings.map(f => f.message).join(" "), publication };
  }
  if (operation === "publish" && graph && !requestId) {
    const readiness = graph.version === 2 ? await loadWorkflowReadiness(businessId) : { ready: true, blockers: [] };
    publication = evaluatePublicationPolicy({ mode: "manual_legacy", businessId, userId, authorized: true,
      revision, candidate: graph, runtimeBlockers: readiness.blockers, capabilities });
    if (!publication.canPublish) return { error: publication.findings.map(f => f.message).join(" "), publication };
  } else if (operation === "enable" && activationGraph?.version === 2) {
    const readiness = await loadWorkflowReadiness(businessId);
    if (!readiness.ready) return { error: `Ruaje si draft dhe provoje. Para aktivizimit: ${readiness.blockers.join(" ")}` };
  }
  if (["publish","enable"].includes(operation) && activationGraph?.nodes.some(n=>n.kind==="action")) {
    try {
      await requireActionAccess(businessId,userId,"business.provision");
      await requireActionAccess(businessId,null,"business.provision",true);
    } catch(e) {return {error:e instanceof Error?e.message:"Veprimi nuk lejohet."};}
  }
  const { data, error } = await createServiceSupabase().rpc(
    requestId ? "apply_assistant_visual_workflow" : "save_visual_workflow",
    {
      p_business: businessId,
      p_user: userId,
      p_revision: revision,
      p_graph: graph,
      p_operation: operation,
      ...(requestId ? { p_request: requestId } : {}),
    },
  );
  if (error)
    return {
      ...(publication ? { publication: error.message.includes("stale_workflow") ? { ...publication, result: "BLOCKED" as const, status: "stale_proposal" as const, canPublish: false, findings: [{ code: "stale_revision", message: "Rrjedha ndryshoi gjatë publikimit. Rifresko faqen dhe kërko miratim të ri." }] } : { ...publication, result: "UNVERIFIED" as const, status: "blocked" as const, canPublish: false, findings: [{ code: "write_unconfirmed", message: "Serveri nuk konfirmoi publikimin. Rifresko historikun përpara se të provosh përsëri." }] } } : {}),
      error: error.message.includes("stale_workflow")
        ? "Rrjedha ndryshoi në një dritare tjetër. Rifresko faqen para ruajtjes."
        : error.message.includes("invalid_workflow_targets")
          ? "Një produkt ose shërbim i lidhur nuk gjendet më në këtë biznes. Hiqe lidhjen e padisponueshme dhe provo përsëri."
        : ["PGRST202", "42883", "42P01"].includes(error.code)
          ? requestId
            ? "Apliko migrimet e workflow-ve vizuale dhe historikut për të ruajtur nga Agjenti."
            : "Apliko migrimin 20261010110000_visual_workflows.sql për të ruajtur rrjedhën."
          : !error.code || error.code.length !== 5
            ? unconfirmedSaveMessage
            : "Rrjedha nuk u ruajt. Provo përsëri.",
    };
  // The RPC commits atomically and returns the new revision. Keep that
  // acknowledgement even if refreshing the editor subsequently fails.
  if (!Number.isInteger(data) || data !== revision + 1) return { error: unconfirmedSaveMessage };
  const receipt = operation === "publish" ? await publicationReceipt(businessId, data as number) : undefined;
  return { savedRevision: data as number, savedGraph: graph ?? undefined, ...(publication ? { publication } : {}), ...(receipt ? { receipt } : {}) };
}

/** The revision's audit event is authoritative; a later workspace read might refer to someone else's publish. */
async function publicationReceipt(businessId: string, revision: number): Promise<PublicationReceipt> {
  try {
    const { data, error } = await createServiceSupabase().from("visual_workflow_events")
      .select("created_at,actor_id,published_version_id:after_data->>published_version_id").eq("business_id", businessId).eq("revision", revision).maybeSingle();
    const versionId = data?.published_version_id;
    if (error || !data || typeof versionId !== "string") throw new Error("receipt_unavailable");
    return { revision, publishedVersionId: versionId, publishedAt: data.created_at, actorId: data.actor_id };
  } catch {
    return { revision, warning: "Publikimi u konfirmua, por hollësitë e versionit nuk u lexuan. Rifresko historikun; mos e publiko përsëri." };
  }
}
