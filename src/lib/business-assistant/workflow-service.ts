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
import { buildAutomationProposal, automationMessage, recheckAutomation, type AutomationProposal } from "./automation-proposal";
import { summarizeWorkflowChanges } from "./semantic-summary";
import type { Access, PlanResult, Ticket } from "./service";
import {
  applyWorkflowOperations,
  workflowPreview,
  workflowProblems,
  type WorkflowCard,
  type Operation,
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
): Promise<PlanResult> {
  const card = await loadAssistantWorkflow(access);
  const w = card.workspace;
  if (p.action === "workflow_catalog") return readWorkflowCatalog(access, card);
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
  let automation: AutomationProposal | undefined;
  if (operation === "draft") {
    automation = await buildAutomationProposal({
      businessId: access.businessId, userId: access.userId, revision: w.revision,
      publishedVersionId: w.publishedVersionId, request: p.requestedText ?? p.message,
      intent: p.automation, before: w.graph, after: graph,
      operations: p.action === "workflow_restore" ? [] : JSON.parse(p.changes.find(c => c.field === "operations")?.value ?? "[]") as Operation[],
    });
    if (!automation.canSaveDraft) return { message: automationMessage(automation), automation, clarifying: true, workflow: { ...card, semanticSummary: summarizeWorkflowChanges(w.graph, w.graph, w.revision, w.publishedVersionId, automation) } };
  }
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
    ...(automation ? { automation } : {}),
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
    message: automation ? automationMessage(automation) : p.message,
    ...(automation ? { automation } : {}),
    preview,
    workflow: {
      ...card,
      ...(operation === "draft" ? { proposed: graph, semanticSummary: summarizeWorkflowChanges(w.graph, graph, w.revision, w.publishedVersionId, automation) } : {}),
    },
    token: encryptSecret(JSON.stringify(ticket)),
  };
}

/** Main-workflow inheritance is a read, not a synthetic branch assignment. */
async function readWorkflowCatalog(access: Access, card: WorkflowCard) {
  const { workspace: w, published } = card;
  if (!w.available)
    throw new AssistantError("Ruajtja e workflow-ve nuk është ende e konfiguruar.");
  const active = Boolean(w.enabled && published);
  const name = (active ? published! : w.graph).name;
  const status = w.generated
    ? "Nuk ka ende një workflow kryesor të ruajtur."
    : active
      ? `Workflow-i kryesor “${name}” është i publikuar dhe aktiv.`
      : published
        ? `Workflow-i kryesor i publikuar “${published.name}” është joaktiv.`
        : `Workflow-i kryesor “${name}” është draft; ende nuk është publikuar.`;
  const db = createServiceSupabase();
  const catalogs = [
    { module: "products", table: "products", label: "Produkte" },
    { module: "services", table: "booking_services", label: "Shërbime" },
  ].filter(catalog => access.modules.includes(catalog.module));
  const counts = await Promise.all(catalogs.map(async catalog => {
    const results = await Promise.all([true, false].map(isActive =>
      db.from(catalog.table).select("id", { count: "exact", head: true })
        .eq("business_id", access.businessId).eq("is_active", isActive),
    ));
    if (results.some(result => result.error || result.count == null))
      throw new AssistantError("Gjendja e katalogut nuk u lexua. Provo përsëri.");
    return `${catalog.label}: ${results[0].count} aktive, ${results[1].count} joaktive.`;
  }));
  const specific = published?.version === 2 && published.flows.some(flow =>
    flow.productIds?.length || flow.serviceIds?.length,
  );
  const genericOrder = published?.version === 2 && published.flows.some(flow =>
    flow.kind === "order" && !flow.productIds?.length && !flow.serviceIds?.length,
  );
  return {
    message: [
      status,
      "Produktet aktive të këtij biznesi trashëgojnë automatikisht workflow-in kryesor kur ai është i publikuar dhe aktiv. Nuk duhet t’i lidhësh një nga një dhe nuk duhet të zgjedhësh një degë për të gjithë katalogun.",
      active
        ? "Mesazhi i klientit hyn te workflow-i kryesor dhe drejtohet sipas kërkesës dhe konfigurimit të tij. Pyetjet për produktet përdorin katalogun aktiv."
        : "Për ta përdorur në bisedat e reja, workflow-i duhet të jetë i publikuar dhe aktiv; kjo kërkon konfirmim më vete.",
      ...counts,
      "Produktet joaktive nuk përdoren nga agjenti i klientit. Aktivizimin e tyre e bën te Produktet, pasi kontrollon të dhënat.",
      specific ? "Versioni i publikuar ka edhe lidhje me degë të posaçme. Ato ruhen; heqja e tyre kërkon një ndryshim të veçantë." : "Proceset e posaçme të porosisë që mund të kenë produktet ruhen.",
      active && published?.version === 2 && !genericOrder
        ? "Workflow-i nuk ka degë të përgjithshme porosie pa lidhje të posaçme; kontrollo hapat e porosisë para se të presësh porosi për çdo produkt."
        : "",
      w.hasUnpublishedChanges ? "Ka edhe ndryshime draft që ende nuk përdoren në bisedat e reja." : "",
      "Ky kontroll nuk ndryshoi produkte, lidhje apo publikimin e workflow-it.",
    ].filter(Boolean).join("\n\n"),
    choices: ["Më trego workflow-in kryesor"],
  };
}
export async function executeWorkflow(access: Access, ticket: Ticket) {
  if (!access.modules.includes("workflows"))
    throw new AssistantError("Workflow-t nuk janë aktivë për këtë biznes.");
  const operation = ticket.values.operation as WorkflowOperation;
  if (`workflow_${operation}` !== ticket.action)
    throw new AssistantError("Konfirmim i pavlefshëm.");
  if (operation === "draft") await recheckAutomation(access.businessId, access.userId, ticket.automation);
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

export const workflowInstructions = `uiContext.workflowSelection.flowId identifies the selected saved flow and nodeId identifies the selected saved step; only resolve it if it exists in data.workflow.workspace.graph. Never invent an unsaved selected step. If local editor dirty is true explain that the owner must save editor changes before assistant changes. If data.workflow is absent and a workflow modification is requested, first return workflow_load with id null and changes [] to load the actual graph; never invent existing node IDs. Workflow actions concern the SINGLE business visual graph. Its root name (workspace.graph.name, or published.name for the live version) is the main workflow, while graph.flows are internal branches, NOT separate main workflows. Products automatically inherit the enabled published business workflow through their business; no per-product or branch binding is required. Only active catalog items are available to the customer agent. workflow_catalog (id null, changes []) reads the actual saved/published main workflow and catalog status and returns a server-verified explanation WITHOUT changing data or issuing a confirmation. Use workflow_catalog for requests to link products to the main/business workflow, including all products, a named root workflow, "me workflow kryesor, jo me rrjedha specifike", or an unspecified "lidh produktet me workflow" without an explicitly selected/named branch. Use it also when the owner challenges an earlier claim that a branch is mandatory. It is available directly from any page without first loading workflow/linear catalogs. Do not ask the owner to choose an internal branch for these requests. Never implement main-workflow inheritance by populating productIds, creating a flow named "workflow kryesor", assigning linear workflows, changing product activation, or publishing automatically. Previous assistant replies claiming products can only bind to a branch are outdated; correct them, do not repeat them. Existing special branch/linear overrides are preserved; removing them is a separate explicit change, not an implicit consequence of main inheritance. Published/enabled workflow status and catalog activation are separate; drafts are not customer-visible. Main routing checks the customer's intent and catalog within the existing configured capabilities; do not promise a missing order/booking capability. Explicitly assigning a SPECIAL branch does not require a separate linear workflow. Only explicitly requested edits to a separate linear step definition use linear actions. workflow_read shows a server-rendered view (id null, changes []). workflow_draft edits the existing draft using ONE changes field operations containing a JSON array of operations: {op:upgrade}, {op:put_flow,flow:{id,label,kind,entryNodeId,nodeIds,productIds?,serviceIds?}}, {op:remove_flow,id}, {op:rename,name}, {op:put_node,node:{id,kind,label,position:{x,y},config:{prompt?,fieldKey?,fieldType?,condition?,value?}}}, {op:remove_node,id}, {op:put_edge,edge:{id,source,target,port}}, {op:remove_edge,id}. put_node supplies a complete node; preserve unrelated config, IDs and positions. put_edge replaces the outgoing edge on the same source/port. remove_node removes incident edges: reconnect explicitly. Never remove start. New node/edge IDs are local alphanumeric identifiers (not database UUIDs). For an existing-order status flow, use order_status as the entry node directly, connected to end. It verifies identity and asks for an owned-order reference itself; do not collect a phone/customer ID first. A status reply completes the current message and returns to the message hub. Kinds start/condition/knowledge/collect/confirm/product/booking/order_status/handoff/end; ports next or yes/no for condition/confirm; fieldType text/email/phone/number/photo; condition intent_order/intent_support/intent_booking/field_present/field_equals. Version 2 enables the message hub, booking and order_status nodes; use upgrade before adding these nodes or flows. Existing v1 graphs stay compatible. A flow has a unique id, label, kind order/booking/information/support/custom, an entryNodeId in its nodeIds, and uniquely assigned nodeIds (a node can belong to only one flow). Flow entry nodes may be disconnected from start: each message is routed directly to the chosen flow. Entry cannot be start/end. Shared nodes may remain outside groups. When adding a step inside a selected flow, include its ID in that flow.nodeIds via put_flow together with put_node/put_edge; preserve both branches and update entryNodeId only when inserting before the entry. Preserve all other flows and their grouping. Flow productIds/serviceIds bind this same visual flow to verified catalog products/services. Any flow kind can be bound; a service binding alone never creates booking capability (that requires an explicit booking node). Resolve requested product/service names using data.product/data.service, verified selectedEntity, selectedEntityIds or search before proposing IDs; if a name is missing or ambiguous, search or clarify, never invent IDs. Only on explicit requests for a special branch binding, use workflow_draft with put_flow on the selected saved branch (flowId), or the clearly named internal branch. An explicit request for the main workflow overrides a contextual branch selection. If the owner explicitly wants a special branch but several match, ask which branch; never block because a linear workflow is absent or create a linear workflow as a substitute. Preserve existing nodeIds, entry, productIds and serviceIds except the requested assignments. Omitted binding arrays preserve their existing values; explicit [] removes assignments. Use at most 200 unique UUIDs per binding array. Each product and each service can belong to only ONE bound flow in this graph: moving it requires explicit removal from its previous flow in the same proposal, with both flows shown in the preview. Empty/absent bindings leave a generic flow. Do not change existing product.workflow_id or service settings to make a visual binding. Bindings are draft-only until publication, and published versions remain immutable. A remove_flow only removes the hub grouping, not its nodes; remove nodes explicitly only if requested. If removing a flow entry, also provide put_flow selecting the intended new entry or remove_flow. No auto-executing edge back to the message hub. End means this turn is complete, not the conversation permanently closed. intent conditions use existing deterministic rules, not arbitrary natural language predicates. Respect 32 nodes, 64 edges. A product node may invoke separately configured product order steps, while assigned visual flows use their own configured steps; collect nodes in shared-context businesses bind canonical customer_name/customer_phone/customer_email/customer_city/customer_address fields. Arbitrary custom keys stay order fields. No automatic CRM promotion. Use linear/orderflow actions only when the owner explicitly requests creating or editing a separate linear product workflow; never use them to link an existing visual flow. An empty linear workflow list does not prevent a visual binding. If scope or target step is ambiguous, clarify with named alternatives. If inserting after a condition/confirm without a specified port, ask Po or Jo before proposing changes. Prefer canonical customer fields over duplicate custom fields. Preserve unaffected branches. A booking node invokes the EXISTING configured booking capability only; do not invent services, availability, bookings or new integrations. Booking configuration and live permissions are enforced at execution. For requests such as "statusi i porosisë", "ku është porosia" or order tracking, propose an actual order_status node in an information flow named "Statusi i porosisë", with its own entry and next edge to an end. This node reads the status of orders belonging to the current conversation customer, scoped by the server to this business and Instagram identity. It never changes, cancels, refunds or creates orders; there are no configurable customer IDs, arbitrary queries, webhooks or executable instructions. Never fulfill status lookup by merely renaming a knowledge node or adding lookup claims to its prompt. If an order_status flow already exists, update that flow only when requested; otherwise preserve its definition and explain its capability. Preserve all unrelated knowledge, support, order and other flows. Missing or ambiguous owned-order matches are handled at execution without exposing other customers or inventing status. Staff handoff is advisory; only explicit staff ownership pauses AI. No payment/custom executable nodes. Multiple edits to ONE graph are ONE action. All workflow actions have id null. workflow_restore restores a specific published version as a DRAFT only, changes [{field:version_id,value:UUID}] chosen from data.workflow.versions. Ask which version if ambiguous. It never directly activates the restored graph. workflow_publish publishes AND activates the current saved draft, with changes []; propose only on an explicit request to publish/activate the draft. workflow_enable enables the existing published version; workflow_disable disables for new conversations; changes [] for both. Changes are draft-only until separately published. When data.workflow.pendingDraft is true, edits apply to that unconfirmed proposal; it must be saved before publishing. Viewing the graph uses workflow_read, not clarify, so the graph is displayed. Explaining catalog inheritance uses workflow_catalog, not workflow_read or clarify. If asked to test, use workflow_read and explain the Provoje button. Never claim a draft is active. For creation, adapt the starter graph without overwriting unrelated existing steps; ask before replacing an existing flow.`;
