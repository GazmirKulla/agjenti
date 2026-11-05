import { withWorkflowSemanticReviews } from "@/lib/capabilities/workflow-semantics";
import { visualGraphHash } from "@/lib/workflows/visual/graph-hash";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { AssistantError, type Proposal } from "./model";
import { openTicket, type Access, type PlanResult } from "./service";
import { executeWorkflow, prepareWorkflow, loadAssistantWorkflow } from "./workflow-service";
import { reviewWorkflowRequest } from "./workflow-request";

/** One authenticated owner turn. Existing draft/publish writers remain the only
 * mutation path; a failed publication leaves the acknowledged draft recoverable. */
export function applyRequestedWorkflow(access: Access, proposal: Proposal, request: string, history: { role: string; content: string }[], revision?: number, pendingGraph?: unknown): Promise<PlanResult> {
  return withWorkflowSemanticReviews(async () => {
    let prepared = await prepareWorkflow(access, proposal, revision, pendingGraph);
    if (!prepared.token || !prepared.workflow || !["workflow_draft", "workflow_publish"].includes(proposal.action)) return prepared;
    const ticket = openTicket(prepared.token, access);
    const candidate = ticket.values.graph as VisualGraph;
    let review: Awaited<ReturnType<typeof reviewWorkflowRequest>>;
    try { review = await reviewWorkflowRequest(request, history, prepared.workflow.workspace.graph, candidate, Number(ticket.before?.revision)); }
    catch (error) { return { ...prepared, token: undefined, clarifying: true, message: error instanceof AssistantError ? error.message : "Verifikimi i kërkesës nuk përfundoi. Propozimi ruhet për vazhdim; nuk u aplikua." }; }
    if (review.mode === "preview") return prepared;
    if (review.mode === "read") return prepareWorkflow(access, { action: "workflow_read", id: null, changes: [], message: "" });
    if (review.mode === "clarify") return { ...prepared, token: undefined, clarifying: true, message: review.question || "Cilin ndryshim dëshiron të zbatoj?" };
    if (proposal.action === "workflow_publish" && review.mode !== "publish") return { ...prepared, token: undefined, message: "Workflow-i nuk u publikua; kërkesa e kufizon ndryshimin në draft." };
    if (review.expires <= Date.now() || review.candidateHash !== visualGraphHash(candidate) || review.revision !== ticket.before?.revision)
      throw new AssistantError("Kërkesa ka skaduar ose workflow-i ndryshoi. Përgatite përsëri.");
    let saved: Awaited<ReturnType<typeof executeWorkflow>> | undefined;
    let savedTicket = ticket;
    try {
      saved = await executeWorkflow(access, ticket);
      if (ticket.action === "workflow_draft" && review.mode === "publish") {
        const current = await loadAssistantWorkflow(access);
        if (current.workspace.revision !== saved.savedRevision || visualGraphHash(current.workspace.graph) !== review.candidateHash || review.expires <= Date.now())
          throw new AssistantError("Drafti u ruajt, por gjendja ndryshoi para publikimit. Nuk u publikua një version tjetër.");
        prepared = await prepareWorkflow(access, { action: "workflow_publish", id: null, changes: [], message: "Publiko ndryshimin e kërkuar.", requestedText: request }, saved.savedRevision);
        if (!prepared.token) return { ...prepared, saved: true, outcome: outcome(savedTicket.id, "workflow_draft"), message: `Drafti u ruajt. Publikimi nuk u krye: ${prepared.message}` };
        const publication = openTicket(prepared.token, access);
        if (visualGraphHash(publication.values.graph as VisualGraph) !== review.candidateHash || publication.before?.revision !== saved.savedRevision || review.expires <= Date.now())
          throw new AssistantError("Drafti ndryshoi para publikimit. Nuk u publikua një version tjetër.");
        const published = await executeWorkflow(access, publication);
        saved = published;
        savedTicket = publication;
      }
      return { ...saved, saved: true, replacePlan: true, outcome: outcome(savedTicket.id, savedTicket.action) };
    } catch (error) {
      // Preserve the candidate and the exact diagnostics, including partial success.
      const message = error instanceof AssistantError ? error.message : "Verifikimi ose ruajtja nuk u konfirmua. Kontrollo gjendjen përpara riprovimit.";
      return { ...prepared, token: undefined, saved: Boolean(saved), ...(saved ? { outcome: outcome(savedTicket.id, savedTicket.action) } : {}),
        workflow: prepared.workflow && { ...prepared.workflow, ...(error instanceof AssistantError && error.publication ? { publication: error.publication } : {}) },
        message: saved ? `Drafti u ruajt. Publikimi nuk u konfirmua: ${message}` : message };
    }
  });
}

function outcome(id: string, action: string) {
  return { status: "backend_acknowledged", action, reference: { table: "assistant_visual_requests", id } };
}
