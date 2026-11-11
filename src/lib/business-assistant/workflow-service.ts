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
import { matchesSimulationBinding, simulateWorkflowProposal, simulationBinding } from "@/lib/workflows/visual/simulation";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import { reviewWorkflowPublication } from "@/lib/workflows/visual/publication-service";
import type { PublicationApproval } from "@/lib/workflows/visual/publication-types";
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
        ? "Ky biznes ende nuk ka workflow të ruajtur. Workflow është opsional; mund të të sugjeroj ose të përgatis një sipas nevojave të biznesit."
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
      ? pendingGraph && p.changes.length === 0 ? base : applyWorkflowOperations(
          base,
          p.changes.find((c) => c.field === "operations")?.value ?? "",
          p.requestedText,
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
    if (!automation.canSaveDraft) return { message: automationMessage(automation), automation, clarifying: true, workflow: { ...card, ...(automation.validationFindings.some(f => f.code === "semantic_review_unavailable" || f.code === "unverified") ? { proposed: graph } : {}),
      simulation: simulateAutomation(w.graph, graph, automation),
      semanticSummary: summarizeWorkflowChanges(w.graph, w.graph, w.revision, w.publishedVersionId, automation) } };
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
  // Publication assesses the ENTIRE saved graph, not just the latest patch.
  const id = randomUUID();
  const publicationReview = operation === "publish" ? await reviewWorkflowPublication({ ...access, graph, revision: w.revision,
    proposalId: randomUUID(), prepared: { workspace: w, published: card.published } }) : undefined;
  if (publicationReview) automation = publicationReview.automation;
  const simulation = publicationReview?.simulation ?? (operation === "draft" ? simulateAutomation(w.graph, graph, automation!) : undefined);
  if (automation && simulation) automation.simulation = simulationBinding(simulation);
  if (publicationReview && !publicationReview.publication.canRequestApproval) return {
    message: publicationReview.publication.findings.map(f => f.message).join(" "),
    automation, workflow: { ...card, simulation, publication: publicationReview.publication },
  };
  if (publicationReview?.publication.limitations?.length)
    preview.notice = `${preview.notice ?? ""} ${publicationReview.publication.findings.find(f => f.code === "publication_limits")?.message ?? ""}`;
  if (simulation) preview.notice = `${preview.notice ?? ""} Simulimi: ${simulation.result}. ${simulation.canPublish ? "U verifikuan skenarët lokalë, jo një garanci e sjelljes së AI." : "Drafti mund të ruhet; kjo nuk do të thotë se automatizimi është validuar plotësisht."}`;
  const ticket: Ticket = {
    ...(simulation ? { simulation: simulationBinding(simulation) } : {}),
    ...(automation ? { automation } : {}),
    purpose: "business-assistant-v1",
    userId: access.userId,
    businessId: access.businessId,
    expires: Date.now() + 600000,
    action: p.action === "workflow_restore" ? "workflow_draft" : p.action,
    id,
    before: { revision: w.revision },
    values: {
      operation,
      ...(operation === "draft" || operation === "publish" ? { graph } : {}),
    },
  };
  if (publicationReview && simulation) ticket.publicationApproval = { ...simulationBinding(simulation), businessId: access.businessId,
    userId: access.userId, requestId: id, expires: ticket.expires, publishedVersionId: w.publishedVersionId,
    acknowledgedLimitations: publicationReview.publication.limitations };
  return {
    message: operation === "draft" && automation ? automationMessage(automation) : p.message,
    ...(automation ? { automation } : {}),
    preview,
    workflow: {
      ...card,
      ...(publicationReview ? { publication: publicationReview.publication } : {}),
      ...(simulation ? { simulation } : {}),
      ...(operation === "draft" ? { proposed: graph, semanticSummary: summarizeWorkflowChanges(w.graph, graph, w.revision, w.publishedVersionId, automation) } : {}),
    },
    token: encryptSecret(JSON.stringify(ticket)),
  };
}

export function simulateAutomation(before: VisualGraph, candidate: VisualGraph, automation: AutomationProposal) {
  return simulateWorkflowProposal({ proposalId: automation.proposalId, baseRevision: automation.baseRevision, before, candidate,
    capabilities: automation.requiredCapabilities,
    assessmentUnavailable: automation.validationFindings.some(f => f.code === "assessment_unavailable"),
    clarificationRequired: automation.clarificationQuestions.length > 0,
  });
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
  if (typeof ticket.id !== "string" || !ticket.id.trim())
    throw new AssistantError("Mungon identiteti i konfirmimit. Përgatite kërkesën përsëri.");
  const operation = ticket.values.operation as WorkflowOperation;
  if (`workflow_${operation}` !== ticket.action)
    throw new AssistantError("Konfirmim i pavlefshëm.");
  if (operation === "draft") {
    const graph = normalizeVisualDraft(ticket.values.graph);
    if (!graph) throw new AssistantError("Grafi i konfirmuar nuk është i vlefshëm.");
    await recheckAutomation(access.businessId, access.userId, ticket.automation, graph);
    const revision = Number(ticket.before?.revision);
    if (ticket.simulation && !matchesSimulationBinding(ticket.simulation, ticket.automation?.proposalId ?? ticket.id, revision, graph))
      throw new AssistantError("Simulimi nuk i përket këtij grafi ose revisioni. Përgatite propozimin përsëri.");
    const workspace = await loadVisualWorkspace(access.businessId);
    if (workspace.revision !== revision) throw new AssistantError("Rrjedha ndryshoi në një dritare tjetër. Përgatite propozimin përsëri.");
    // Rerun even for legacy tickets. Evidence is never trusted from the browser or reused after a graph change.
    const automation = ticket.automation;
    if (automation) simulateAutomation(workspace.graph, graph, automation);
    else simulateWorkflowProposal({ proposalId: ticket.id, baseRevision: revision, before: workspace.graph, candidate: graph });
  }
  // Existing Phase 4 tickets carry the same sealed identity/hash fields. Do not accept an unbound legacy publication.
  const approval: PublicationApproval | undefined = ticket.publicationApproval ?? (ticket.simulation && ticket.automation ? {
    ...ticket.simulation, businessId: ticket.businessId, userId: ticket.userId, requestId: ticket.id,
    expires: ticket.expires, publishedVersionId: ticket.automation.workflowVersionId,
  } : undefined);
  const result = await writeVisualWorkflow(
    access.businessId,
    access.userId,
    Number(ticket.before?.revision),
    ticket.values.graph,
    operation,
    ticket.id,
    approval,
  );
  if (result.error) throw new AssistantError(result.error, result.publication);
  // The committed receipt remains authoritative even if the read-back fails.
  let workflow: WorkflowCard | undefined;
  try {
    const refreshed = await loadAssistantWorkflow(access);
    if (refreshed.workspace.revision === result.savedRevision) workflow = refreshed;
  } catch { /* Do not turn a confirmed write into an apparent failure. */ }
  return {
    ...(workflow ? { workflow } : {}),
    message:
      operation === "draft"
        ? "Drafti i rrjedhës u ruajt. Ende nuk është publikuar."
        : operation === "publish"
          ? "Rrjedha u publikua dhe u aktivizua për bisedat e reja."
          : operation === "enable"
            ? "Versioni i publikuar u aktivizua."
            : "Rrjedha u çaktivizua për bisedat e reja.",
    path: "workflows",
    savedRevision: result.savedRevision,
    ...(result.receipt ? { receipt: result.receipt } : {}),
  };
}

