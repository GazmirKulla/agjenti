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
import { loadVisualBindingCatalog } from "@/lib/workflows/visual/bindings";
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
  const bindingCatalog = ["draft", "publish"].includes(operation)
    ? await loadVisualBindingCatalog(access.businessId, [w.graph, graph, ...(card.published ? [card.published] : [])])
    : { products: [], services: [] };
  if (["draft", "publish"].includes(operation) && graph.version === 2) {
    const productIds = new Set(bindingCatalog.products.map(product => product.id));
    const serviceIds = new Set(bindingCatalog.services.map(service => service.id));
    if (graph.flows.some(flow => flow.productIds?.some(id => !productIds.has(id)) || flow.serviceIds?.some(id => !serviceIds.has(id))))
      throw new AssistantError("Një produkt ose shërbim i zgjedhur nuk gjendet në këtë biznes. Rifresko zgjedhjen.");
  }
  let preview: Preview;
  if (operation === "draft") {
    preview = workflowPreview(w.graph, graph, bindingCatalog);
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
            bindingCatalog,
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

export const workflowInstructions = `uiContext.workflowSelection.flowId identifies the selected saved flow and nodeId identifies the selected saved step; only resolve it if it exists in data.workflow.workspace.graph. Never invent an unsaved selected step. If local editor dirty is true explain that the owner must save editor changes before assistant changes. If data.workflow is absent and a workflow modification is requested, first return workflow_load with id null and changes [] to load the actual graph; never invent existing node IDs. Workflow actions concern the SINGLE business visual graph and its grouped message-hub flows; assigning this visual flow to selected products/services does not require a separate linear workflow. Only explicitly requested edits to a separate linear step definition use linear actions. workflow_read shows a server-rendered view (id null, changes []). workflow_draft edits the existing draft using ONE changes field operations containing a JSON array of operations: {op:upgrade}, {op:put_flow,flow:{id,label,kind,entryNodeId,nodeIds,productIds?,serviceIds?}}, {op:remove_flow,id}, {op:rename,name}, {op:put_node,node:{id,kind,label,position:{x,y},config:{prompt?,fieldKey?,fieldType?,condition?,value?}}}, {op:remove_node,id}, {op:put_edge,edge:{id,source,target,port}}, {op:remove_edge,id}. put_node supplies a complete node; preserve unrelated config, IDs and positions. put_edge replaces the outgoing edge on the same source/port. remove_node removes incident edges: reconnect explicitly. Never remove start. New node/edge IDs are local alphanumeric identifiers (not database UUIDs). For an existing-order status flow, use order_status as the entry node directly, connected to end. It verifies identity and asks for an owned-order reference itself; do not collect a phone/customer ID first. A status reply completes the current message and returns to the message hub. Kinds start/condition/knowledge/collect/confirm/product/booking/order_status/handoff/end; ports next or yes/no for condition/confirm; fieldType text/email/phone/number/photo; condition intent_order/intent_support/intent_booking/field_present/field_equals. Version 2 enables the message hub, booking and order_status nodes; use upgrade before adding these nodes or flows. Existing v1 graphs stay compatible. A flow has a unique id, label, kind order/booking/information/support/custom, an entryNodeId in its nodeIds, and uniquely assigned nodeIds (a node can belong to only one flow). Flow entry nodes may be disconnected from start: each message is routed directly to the chosen flow. Entry cannot be start/end. Shared nodes may remain outside groups. Preserve all other flows and their grouping. Flow productIds/serviceIds bind this same visual flow to verified catalog products/services. Any flow kind can be bound; a service binding alone never creates booking capability (that requires an explicit booking node). Resolve requested product/service names using data.product/data.service, verified selectedEntity, selectedEntityIds or search before proposing IDs; if a name is missing or ambiguous, search or clarify, never invent IDs. On requests to link this existing workflow or flow to products/services, use workflow_draft with put_flow on the selected saved flow (flowId), or the clearly named flow. If no flow is selected and several match, ask which existing flow; never block because a linear workflow is absent or create a linear workflow as a substitute. Preserve existing nodeIds, entry, productIds and serviceIds except the requested assignments. Omitted binding arrays preserve their existing values; explicit [] removes assignments. Use at most 200 unique UUIDs per binding array. Each product and each service can belong to only ONE bound flow in this graph: moving it requires explicit removal from its previous flow in the same proposal, with both flows shown in the preview. Empty/absent bindings leave a generic flow. Do not change existing product.workflow_id or service settings to make a visual binding. Bindings are draft-only until publication, and published versions remain immutable. A remove_flow only removes the hub grouping, not its nodes; remove nodes explicitly only if requested. If removing a flow entry, also provide put_flow selecting the intended new entry or remove_flow. No auto-executing edge back to the message hub. End means this turn is complete, not the conversation permanently closed. intent conditions use existing deterministic rules, not arbitrary natural language predicates. Respect 32 nodes, 64 edges. A product node may invoke separately configured product order steps, while assigned visual flows use their own configured steps; collect nodes in shared-context businesses bind canonical customer_name/customer_phone/customer_email/customer_city/customer_address fields. Arbitrary custom keys stay order fields. No automatic CRM promotion. Use linear/orderflow actions only when the owner explicitly requests creating or editing a separate linear product workflow; never use them to link an existing visual flow. An empty linear workflow list does not prevent a visual binding. If scope or target step is ambiguous, clarify with named alternatives. If inserting after a condition/confirm without a specified port, ask Po or Jo before proposing changes. Prefer canonical customer fields over duplicate custom fields. Preserve unaffected branches. A booking node invokes the EXISTING configured booking capability only; do not invent services, availability, bookings or new integrations. Booking configuration and live permissions are enforced at execution. For requests such as "statusi i porosisë", "ku është porosia" or order tracking, propose an actual order_status node in an information flow named "Statusi i porosisë", with its own entry and next edge to an end. This node reads the status of orders belonging to the current conversation customer, scoped by the server to this business and Instagram identity. It never changes, cancels, refunds or creates orders; there are no configurable customer IDs, arbitrary queries, webhooks or executable instructions. Never fulfill status lookup by merely renaming a knowledge node or adding lookup claims to its prompt. If an order_status flow already exists, update that flow only when requested; otherwise preserve its definition and explain its capability. Preserve all unrelated knowledge, support, order and other flows. Missing or ambiguous owned-order matches are handled at execution without exposing other customers or inventing status. Staff handoff is advisory; only explicit staff ownership pauses AI. No payment/custom executable nodes. Multiple edits to ONE graph are ONE action. All workflow actions have id null. workflow_restore restores a specific published version as a DRAFT only, changes [{field:version_id,value:UUID}] chosen from data.workflow.versions. Ask which version if ambiguous. It never directly activates the restored graph. workflow_publish publishes AND activates the current saved draft, with changes []; propose only on an explicit request to publish/activate the draft. workflow_enable enables the existing published version; workflow_disable disables for new conversations; changes [] for both. Changes are draft-only until separately published. When data.workflow.pendingDraft is true, edits apply to that unconfirmed proposal; it must be saved before publishing. Viewing/explaining uses workflow_read, not clarify, so the graph is displayed. If asked to test, use workflow_read and explain the Provoje button. Never claim a draft is active. For creation, adapt the starter graph without overwriting unrelated existing steps; ask before replacing an existing flow.`;
