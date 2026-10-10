import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  loadVisualWorkspace,
  loadVisualVersion,
} from "@/lib/workflows/visual/store";
import {
  writeVisualWorkflow,
  type WorkflowOperation,
} from "@/lib/workflows/visual/mutations";
import {
  normalizeVisualDraft,
  validateVisualGraph,
} from "@/lib/workflows/visual/model";
import { encryptSecret } from "@/lib/crypto/tokens";
import { AssistantError, type Proposal, type Preview } from "./model";
import type { Access, Ticket } from "./service";
import {
  applyWorkflowOperations,
  workflowPreview,
  workflowProblems,
  type WorkflowCard,
} from "./workflow";

export async function loadAssistantWorkflow(
  access: Access,
): Promise<WorkflowCard> {
  if (!access.modules.includes("workflows"))
    throw new AssistantError("Workflow-t nuk janë aktivë për këtë biznes.");
  const workspace = await loadVisualWorkspace(access.businessId);
  if (!workspace.available) return { workspace, published: null, versions: [] };
  const published = workspace.publishedVersionId
    ? await loadVisualVersion(access.businessId, workspace.publishedVersionId)
    : null;
  const { data: versions, error } = await createServiceSupabase()
    .from("visual_workflow_versions")
    .select("id,created_at")
    .eq("business_id", access.businessId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new AssistantError("Nuk u lexuan versionet e rrjedhës.");
  return {
    workspace,
    published: published?.graph ?? null,
    versions: versions ?? [],
  };
}
export async function prepareWorkflow(
  access: Access,
  p: Proposal,
  expectedRevision?: number,
  pendingGraph?: unknown,
) {
  const card = await loadAssistantWorkflow(access);
  const w = card.workspace;
  if (p.action === "workflow_read")
    return {
      message: w.generated
        ? "Kjo është rrjedha fillestare e sugjeruar; ende nuk është ruajtur ose aktivizuar."
        : "Këtu është rrjedha e biznesit. Drafti dhe versioni i publikuar shfaqen veçmas.",
      workflow: card,
    };
  if (!w.available)
    throw new AssistantError(
      "Ruajtja e workflow-ve nuk është ende e konfiguruar. Administratori duhet të aplikojë migrimin e workflow-ve vizuale.",
    );
  if (expectedRevision !== undefined && expectedRevision !== w.revision)
    throw new AssistantError(
      "Rrjedha ndryshoi gjatë analizës. Përgatite kërkesën përsëri.",
    );
  const operation = (
    p.action === "workflow_restore"
      ? "draft"
      : p.action.slice("workflow_".length)
  ) as WorkflowOperation;
  if (!["draft", "publish", "enable", "disable"].includes(operation))
    throw new AssistantError("Veprimi i rrjedhës nuk mbështetet.");
  const restored =
    p.action === "workflow_restore"
      ? await loadVisualVersion(
          access.businessId,
          p.changes.find((c) => c.field === "version_id")?.value,
        )
      : null;
  if (p.action === "workflow_restore" && !restored)
    throw new AssistantError("Versioni nuk u gjet në këtë biznes.");
  const base = pendingGraph ? normalizeVisualDraft(pendingGraph) : w.graph;
  if (!base) throw new AssistantError("Drafti nuk është i vlefshëm.");
  const graph =
    restored?.graph ??
    (operation === "draft"
      ? applyWorkflowOperations(
          base,
          p.changes.find((c) => c.field === "operations")?.value ?? "",
        )
      : w.graph);
  let preview: Preview;
  if (operation === "draft") {
    preview = workflowPreview(w.graph, graph);
    if (!preview.fields.length)
      return { message: "Rrjedha është tashmë siç e kërkove.", workflow: card };
    const problems = workflowProblems(graph);
    if (problems.length)
      preview.notice += ` Para publikimit duhen plotësuar: ${problems.join(" ")}`;
  } else {
    if (operation === "publish" && !validateVisualGraph(graph).graph)
      throw new AssistantError(workflowProblems(graph).join(" "));
    if (
      (operation === "enable" || operation === "disable") &&
      !w.publishedVersionId
    )
      throw new AssistantError("Nuk ka ende një version të publikuar.");
    if (
      (operation === "enable" && w.enabled) ||
      (operation === "disable" && !w.enabled)
    )
      return {
        message: "Rrjedha është tashmë në këtë gjendje.",
        workflow: card,
      };
    preview =
      operation === "publish"
        ? workflowPreview(
            card.published ?? { ...graph, name: "—", nodes: [], edges: [] },
            graph,
          )
        : { title: "", fields: [] };
    preview.title =
      operation === "publish"
        ? "Publiko dhe aktivizo rrjedhën"
        : operation === "enable"
          ? "Aktivizo versionin e publikuar"
          : "Çaktivizo rrjedhën";
    preview.subject = graph.name;
    preview.fields.push({
      label: "Statusi për bisedat e reja",
      before: w.enabled ? "Aktiv" : "Joaktiv",
      after:
        operation === "disable"
          ? "Joaktiv"
          : operation === "publish"
            ? "Aktiv me këtë draft"
            : "Aktiv me versionin e publikuar",
    });
    preview.notice =
      "Bisedat vizuale në proces vazhdojnë me versionin e tyre. Workflow-t e porosive të produkteve nuk ndryshohen.";
  }
  const ticket: Ticket = {
    purpose: "business-assistant-v1",
    userId: access.userId,
    businessId: access.businessId,
    expires: Date.now() + 600000,
    action: p.action === "workflow_restore" ? "workflow_draft" : p.action,
    id: randomUUID(),
    before: { revision: w.revision },
    values: {
      operation,
      ...(operation === "draft" || operation === "publish" ? { graph } : {}),
    },
  };
  return {
    message: p.message,
    preview,
    workflow: {
      ...card,
      ...(operation === "draft" ? { proposed: graph } : {}),
    },
    token: encryptSecret(JSON.stringify(ticket)),
  };
}
export async function executeWorkflow(access: Access, ticket: Ticket) {
  if (!access.modules.includes("workflows"))
    throw new AssistantError("Workflow-t nuk janë aktivë për këtë biznes.");
  const operation = ticket.values.operation as WorkflowOperation;
  if (`workflow_${operation}` !== ticket.action)
    throw new AssistantError("Konfirmim i pavlefshëm.");
  const result = await writeVisualWorkflow(
    access.businessId,
    access.userId,
    Number(ticket.before?.revision),
    ticket.values.graph,
    operation,
    ticket.id,
  );
  if (result.error) throw new AssistantError(result.error);
  return {
    message:
      operation === "draft"
        ? "Drafti i rrjedhës u ruajt. Ende nuk është publikuar."
        : operation === "publish"
          ? "Rrjedha u publikua dhe u aktivizua për bisedat e reja."
          : operation === "enable"
            ? "Versioni i publikuar u aktivizua."
            : "Rrjedha u çaktivizua për bisedat e reja.",
    path: "workflows",
  };
}

export const workflowInstructions = `uiContext.workflowSelection.nodeId identifies the selected saved step; only resolve it if it exists in data.workflow.workspace.graph. Never invent an unsaved selected step. If local editor dirty is true explain that the owner must save editor changes before assistant changes. If data.workflow is absent and a workflow modification is requested, first return workflow_load with id null and changes [] to load the actual graph; never invent existing node IDs. Workflow actions concern the SINGLE business visual graph, not linear product order steps. workflow_read shows a server-rendered view (id null, changes []). workflow_draft edits the existing draft using ONE changes field operations containing a JSON array of operations: {op:rename,name}, {op:put_node,node:{id,kind,label,position:{x,y},config:{prompt?,fieldKey?,fieldType?,condition?,value?}}}, {op:remove_node,id}, {op:put_edge,edge:{id,source,target,port}}, {op:remove_edge,id}. put_node supplies a complete node; preserve unrelated config, IDs and positions. put_edge replaces the outgoing edge on the same source/port. remove_node removes incident edges: reconnect explicitly. Never remove start. New node/edge IDs are local alphanumeric identifiers (not database UUIDs). Kinds start/condition/knowledge/collect/confirm/product/handoff/end; ports next or yes/no for condition/confirm; fieldType text/email/phone/number/photo; condition intent_order/intent_support/field_present/field_equals. intent conditions use existing deterministic rules, not arbitrary natural language predicates. Respect 32 nodes, 64 edges. A product node invokes separately configured product order steps; collect nodes in shared-context businesses bind canonical customer_name/customer_phone/customer_email/customer_city/customer_address fields. Arbitrary custom keys stay order fields. No automatic CRM promotion. If linear workflow actions are enabled, use them for product-specific steps; otherwise use orderflow_load and the orderflow actions. Never substitute a global visual edit. If scope or target step is ambiguous, clarify with named alternatives. If inserting after a condition/confirm without a specified port, ask Po or Jo before proposing changes. Prefer canonical customer fields over duplicate custom fields. Preserve unaffected branches. No reservation/payment/custom executable nodes. Multiple edits to ONE graph are ONE action. All workflow actions have id null. workflow_restore restores a specific published version as a DRAFT only, changes [{field:version_id,value:UUID}] chosen from data.workflow.versions. Ask which version if ambiguous. It never directly activates the restored graph. workflow_publish publishes AND activates the current saved draft, with changes []; propose only on an explicit request to publish/activate the draft. workflow_enable enables the existing published version; workflow_disable disables for new conversations; changes [] for both. Changes are draft-only until separately published. When data.workflow.pendingDraft is true, edits apply to that unconfirmed proposal; it must be saved before publishing. Viewing/explaining uses workflow_read, not clarify, so the graph is displayed. If asked to test, use workflow_read and explain the Provoje button. Never claim a draft is active. For creation, adapt the starter graph without overwriting unrelated existing steps; ask before replacing an existing flow.`;
