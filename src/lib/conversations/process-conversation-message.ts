import { randomUUID } from "node:crypto";
import { processBookingTurn, type BookingDraft } from "@/lib/calendar/agent";
import type { BookingEffectGuard } from "@/lib/calendar/service";
import { agentModel } from "@/lib/agents/generate";
import { processAgentTurn, processLegacyAgentTurn, type AgentTurnParams, type AgentTurnResult } from "./process-agent-turn";
import { emptyState, foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { affirmative, extractExplicitFacts, isQuestion, migrateContext, resetOrder, setFact, sharedWorkflowEnabled } from "@/lib/workflows/context";
import { extractMessageFacts, profileExtractionFields } from "@/lib/workflows/extract-facts";
import { chooseGuidance, explicitIntent, rememberTurn } from "@/lib/workflows/guidance";
import { bookingAdapterState, migrateConversationProcesses, restoreOrder, snapshotOrder, type ConversationRouting, type ProcessKind } from "@/lib/workflows/conversation-processes";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import { customerOrderStatus, isOrderStatusFollowUp, isOrderStatusRequest, readOrderStatusLookup, setOrderStatusLookup, type OrderCustomerIdentity } from "@/lib/orders/customer-status";
import { isEntityInformationRequest, resolveVisualEntity } from "@/lib/workflows/visual/entity-routing";

export type ConversationMessageParams = AgentTurnParams & {
  /** Server webhook identity, never accepted from chat text or preview state. */
  customerIdentity?: OrderCustomerIdentity;
  conversationKey?: string;
  bookingGuard?: BookingEffectGuard;
  /** Production adapter rechecks manual ownership immediately before booking effects. */
  canAct?: () => Promise<boolean>;
};
type Route = Pick<ConversationRouting, "process" | "source">;
const namedConfirmation = (message: string): ProcessKind | null => { const match = foldText(message).match(/^(?:po )?(?:e )?konfirmoj (porosine|rezervimin)[.!\s]*$/); return match ? match[1] === "porosine" ? "order" : "booking" : null; };
const contactChannel = (message: string) => /^(?:whatsapp|telefon|phone|instagram)[.!\s]*$/.test(foldText(message));
const bookingRequest = (text: string) => /\b(rezerv\w*|takim\w*|appointment|booking|termin|orar\w* (?:te )?lir\w*)\b/.test(text);
const informationalQuestion = (text: string) => /\b(sa kushton|cmimi|price|ku ndodhe|ku jeni|kur hap|orar(?:i)? (?:i punes|punes)|si pagu|pagesa|sa zgjat|what.*cost|how much)\b/.test(text);
const resumeOrder = (text: string) => /\b(vazhdo\w*|ktheh\w*|rifill\w*|resume)\b.*\b(porosi\w*|order)\b/.test(text);
const newRequest = (text: string, kind: ProcessKind) => kind === "order" ? /\b(porosi (?:te |nje )?re|porosi tjeter|new order|another order)\b/.test(text) : /\b(rezervim (?:te |nje )?ri|rezervim tjeter|takim tjeter|new booking|another booking)\b/.test(text);

async function routeMessage(message: string, state: ConversationStatePayload): Promise<Route> {
  const text = foldText(message), intent = explicitIntent(message);
  const confirmation = namedConfirmation(message);
  if (confirmation) return { process: confirmation, source: "rules" };
  if (state.visual?.status === "handoff" && contactChannel(message)) return { process: "support", source: "rules" };
  // Managing an already persisted appointment remains a staff action.
  if (/\b(ndrysho\w*|anulo\w*|cancel|reschedule)\b/.test(text) && bookingRequest(text) && /\b(ekzistues\w*|konfirmuar|mepar\w*|existing|confirmed)\b/.test(text)) return { process: "support", source: "rules" };
  const order = intent === "order" || resumeOrder(text) || /^(porosia|porosine|order)[.!\s]*$/.test(text);
  if (informationalQuestion(text) && !order && !/\b(dua|kerkoj|rezervo|book|want|vazhdo|rifillo)\b/.test(text)) return { process: "information", source: "rules" };
  const booking = bookingRequest(text) && !/\b(nuk dua|s dua|do not want)\b/.test(text);
  if (order && booking) return { process: "clarify", source: "rules" };
  if (order) return { process: "order", source: "rules" };
  if (booking) return { process: "booking", source: "rules" };
  if (intent === "support") return { process: "support", source: "rules" };
  if (isQuestion(message) && !/\b(ndrysho\w*|korrigjo\w*)\b/.test(text)) return { process: "information", source: "rules" };
  if (affirmative(message) || /^(jo|no)[.!\s]*$/.test(text)) return { process: state.processes!.auxiliary?.process ?? state.processes!.active ?? "information", source: "rules" };
  const active = state.processes!.active;
  const guidance = await chooseGuidance({ message, state, targets: [],
    current: active ? { id: active, label: active === "booking" ? "Plotësimi i rezervimit" : "Plotësimi i porosisë", kind: active } : undefined,
    routes: [{ id: "order", label: "Nis ose rifillo porosinë e produktit", kind: "product" }, { id: "booking", label: "Nis ose rifillo rezervimin e shërbimit", kind: "booking" }],
    allowOrder: true, allowSupport: false,
  });
  if (guidance.action === "route" && guidance.target === "booking") return { process: "booking", source: guidance.source };
  if (guidance.action === "order" || (guidance.action === "route" && guidance.target === "order")) return { process: "order", source: guidance.source };
  if (guidance.action === "answer") return { process: "information", source: guidance.source };
  // Detailed corrections/backtracking are handled by the selected process's existing guidance engine.
  if (guidance.action === "clarify" && !active && state.visual?.status === "handoff") return { process: "information", source: guidance.source };
  return { process: state.processes!.auxiliary?.process ?? active ?? (state.processes!.order?.status === "suspended" ? "information" : "order"), source: guidance.source };
}

function plainResult(state: ConversationStatePayload, reply: string): AgentTurnResult {
  return { reply, nextState: state, previousResponseId: null, workflowId: state.context?.execution.linear?.id ?? null,
    productName: null, workflowProgress: [], debug: { model: agentModel(), source: "fallback", fallbackReason: "conversation_routing", agentConfigured: true,
      knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
function explicitProfile(state: ConversationStatePayload, message: string, profileOnly = false) {
  extractExplicitFacts(state, message, profileOnly ? [] : state.context?.execution.linear?.steps ?? []);
  // Contact labels anchor the number to this customer's own statement, including mixed question/fact turns.
  const phone = message.match(/(?:telefoni?\s*(?:im)?|numri\s+im|my\s+(?:phone|number))\s*(?:(?:është|eshte|is)\s*|[:=]\s*)(\+?[\d ().-]{7,24}\d)/i);
  if (phone) setFact(state, "customer_phone", phone[1].trim(), "phone", "message_phone");
}

/** One message coordinator for Instagram, isolated chat and graph previews. Adapters own persistence/send. */
export async function processConversationMessage(params: ConversationMessageParams): Promise<AgentTurnResult> {
  if (params.canAct && !(await params.canAct())) throw new Error("conversation_manually_paused");
  const statusRequested = isOrderStatusRequest(params.message) || isOrderStatusFollowUp(params.message, params.state);
  const statusTurn = async (state: ConversationStatePayload) => {
    const result = await customerOrderStatus({ businessId: params.businessId, message: params.message, state,
      identity: params.customerIdentity, isolated: params.mode === "test" || Boolean(params.visualPreview) || Boolean(params.linearPreview) });
    return { ...plainResult(result.nextState, result.reply), orderStatusPending: result.pending };
  };
  // The adapter is supplied here, never accepted from a customer-controlled chat payload.
  params = { ...params, orderStatusTurn: statusTurn };
  if (statusRequested) {
    const state = migrateConversationProcesses(params.state, randomUUID);
    const profileBefore = JSON.stringify(state.context!.profile);
    explicitProfile(state, params.message, true);
    if (JSON.stringify(state.context!.profile) !== profileBefore && state.processes!.order) {
      state.processes!.order.snapshot.execution.orderConfirmed = false;
      state.processes!.order.snapshot.execution.awaitingOrderConfirmation = false;
    }
    // The status answer replaces the last question. Preserve tasks, but do not let a
    // later bare yes accept an older replace/process choice the customer no longer sees.
    delete state.processes!.pendingChoice;
    if (state.processes!.service) state.processes!.service.promptCurrent = false;
    const lookup = readOrderStatusLookup(state);
    const version = params.visualPreview ?? await loadVisualVersion(params.businessId, lookup?.visual?.versionId);
    const statusNode = version?.graph.version === 2 ? version.graph.nodes.find(node => node.kind === "order_status") : undefined;
    const configured = Boolean(statusNode);
    const adapter = structuredClone(state);
    adapter.visual = lookup?.visual ?? (statusNode && version ? { versionId: version.id, nodeId: statusNode.id, status: "waiting", awaiting: true, visited: [statusNode.id], values: {} } : undefined);
    const result = configured ? await processAgentTurn({ ...params, state: adapter, orderStatusRequest: true })
      : params.mode === "test" || params.visualPreview || params.linearPreview ? await statusTurn(state)
      : plainResult(state, "Kontrolli automatik i statusit të porosisë nuk është aktiv për këtë biznes. Kontakto stafin për ta kontrolluar porosinë.");
    // Status checks are read-only interruptions. Only their own lookup cursor changes.
    const nextLookup = readOrderStatusLookup(result.nextState);
    if (nextLookup && result.nextState.visual) nextLookup.visual = structuredClone(result.nextState.visual);
    setOrderStatusLookup(state, nextLookup);
    state.processes!.promptOwner = null;
    const decision: ConversationRouting = { process: "information", action: result.orderStatusPending ? "clarify" : "answer", source: "rules",
      reason: "Kontrollohet statusi i porosisë ekzistuese; proceset në vazhdim ruhen.", reusedFields: [], missingFields: result.orderStatusPending ? ["order_reference"] : [] };
    state.processes!.lastDecision = decision;
    result.nextState = state; result.conversationRouting = decision;
    rememberTurn(params.state, state, params.message, result.reply);
    params.onTrace?.({ stage: "workflow", label: "Customer order status", data: decision });
    return result;
  }
  // An unrelated request ends the short-lived choice; a later number must not select an old list.
  if (params.state && readOrderStatusLookup(params.state, true)) {
    params = { ...params, state: structuredClone(params.state) };
    setOrderStatusLookup(params.state!);
  }
  if (params.linearPreview) return processAgentTurn(params);
  if (params.mode !== "test" && !params.bookingGuard && params.state?.schemaVersion !== 3 && !params.visualPreview) {
    if (sharedWorkflowEnabled(params.businessId)) throw new Error("workflow_queue_required");
    // Keep the existing production behavior until this tenant's queue/migration pilot is enabled.
    return await processBookingTurn(params) ?? processAgentTurn(params);
  }
  let state = migrateConversationProcesses(params.state, randomUUID);
  const processes = state.processes!;
  const oldProfile = JSON.stringify(state.context!.profile);
  const graphVersion = params.visualPreview ?? await loadVisualVersion(params.businessId, processes.active === "booking" ? processes.booking?.versionId : state.visual?.versionId);
  const entityMessage = processes.pendingChoice?.kind === "replace" && affirmative(params.message) ? processes.pendingChoice.message : params.message;
  const ordinaryQuestion = isEntityInformationRequest(entityMessage) || isQuestion(entityMessage) && !/\b(dua|kerkoj|rezervo|book|want|vazhdo|rifillo)\b/.test(foldText(entityMessage));
  const continueService = processes.service?.status === "active" && !ordinaryQuestion && !["order", "support"].includes(explicitIntent(params.message)) && !bookingRequest(foldText(params.message));
  let serviceVersion = continueService ? params.visualPreview ?? await loadVisualVersion(params.businessId, processes.service!.versionId) : graphVersion;
  let entityResolution = !ordinaryQuestion && serviceVersion ? await resolveVisualEntity(params.businessId, serviceVersion.graph, entityMessage, continueService ? processes.service?.visual.binding : undefined, params.mode === "test") : {};
  let resumingService = Boolean(continueService && entityResolution.selected?.entity.id === processes.service?.visual.binding?.entity.id);
  if (!ordinaryQuestion && !continueService && processes.service && processes.service.status !== "completed") {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, processes.service.versionId);
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, undefined, params.mode === "test") : {};
    if (match.selected && match.selected.entity.id === processes.service.visual.binding?.entity.id && match.selected.entity.kind === processes.service.visual.binding.entity.kind) { entityResolution = match; serviceVersion = pinned; resumingService = true; }
  }
  let resumingOrder = false;
  const orderVisual = processes.order?.status !== "completed" ? processes.order?.snapshot.visual : undefined;
  if (!ordinaryQuestion && orderVisual?.binding && !processes.pendingChoice) {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, orderVisual.versionId);
    const continuing = processes.active === "order" && explicitIntent(entityMessage) !== "support" && !bookingRequest(foldText(entityMessage));
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, resumeOrder(foldText(entityMessage)) || continuing ? orderVisual.binding : undefined, params.mode === "test") : {};
    if (match.selected?.entity.kind === "product" && match.selected.entity.id === orderVisual.binding.entity.id) { entityResolution = match; serviceVersion = pinned; resumingOrder = true; resumingService = false; }
  }
  let resumingBooking = false;
  const bookingVisual = processes.booking?.status !== "completed" ? processes.booking?.visual : undefined;
  if (!ordinaryQuestion && bookingVisual?.binding && !processes.pendingChoice) {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, bookingVisual.versionId);
    const continuing = processes.active === "booking" && !["order", "support"].includes(explicitIntent(entityMessage)) && !resumeOrder(foldText(entityMessage));
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, continuing ? bookingVisual.binding : undefined, params.mode === "test") : {};
    if (match.selected?.entity.kind === "service" && match.selected.entity.id === bookingVisual.binding.entity.id) { entityResolution = match; serviceVersion = pinned; resumingBooking = true; resumingService = false; resumingOrder = false; }
  }
  const freshEntityVersion = !ordinaryQuestion && !resumingService && !resumingOrder && !resumingBooking && Boolean(state.visual);
  if (freshEntityVersion && !params.visualPreview) {
    const latest = await loadVisualVersion(params.businessId);
    entityResolution = latest ? await resolveVisualEntity(params.businessId, latest.graph, entityMessage, undefined, params.mode === "test") : {};
    serviceVersion = latest;
  }
  const selectedEntity = entityResolution.selected;
  if (entityResolution.choices?.length) {
    processes.promptOwner = null;
    if (processes.service) processes.service.promptCurrent = false;
    return plainResult(state, `Cilin produkt ose shërbim dëshiron: ${entityResolution.choices.map(entity => entity.name).join(", ")}?`);
  }
  const entityFlow = selectedEntity && serviceVersion?.graph.version === 2 ? serviceVersion.graph.flows.find(flow => flow.id === selectedEntity.binding.flowId) : undefined;
  const serviceBooking = selectedEntity?.entity.kind === "service" && entityFlow?.nodeIds.some(id => serviceVersion!.graph.nodes.some(node => node.id === id && node.kind === "booking"));
  const productOrder = selectedEntity?.entity.kind === "product" && Boolean(entityFlow && (entityFlow.kind === "order" || entityFlow.nodeIds.some(id => serviceVersion!.graph.nodes.some(node => node.id === id && node.kind === "product")) || entityFlow.kind === "custom" && (explicitIntent(entityMessage) === "order" || processes.order?.snapshot.product_id === selectedEntity.entity.id && orderVisual?.binding?.entity.id === selectedEntity.entity.id)));
  if (selectedEntity && entityFlow && !productOrder && !serviceBooking && serviceVersion && !processes.pendingChoice) {
    if (affirmative(params.message) && processes.service && !processes.service.promptCurrent) return plainResult(state, "Cilën kërkesë dëshiron të konfirmosh? Shkruaj shërbimin që dëshiron të vazhdosh.");
    if (processes.active === "order" && processes.order) processes.order.snapshot = snapshotOrder(state);
    if (processes.active && processes[processes.active]) processes[processes.active]!.status = "suspended";
    const old = processes.service?.status !== "completed" && processes.service?.visual.binding?.entity.id === selectedEntity.entity.id ? processes.service : undefined;
    const adapter = migrateContext(emptyState()); adapter.schemaVersion = 3; adapter.processes = processes;
    adapter.context!.profile = structuredClone(state.context!.profile); adapter.customer = structuredClone(state.customer); adapter.recentMessages = state.recentMessages;
    adapter.fields = structuredClone(old?.fields ?? {}); adapter.context!.order = structuredClone(old?.order ?? {});
    adapter.visual = old?.visual ?? { versionId: serviceVersion.id, nodeId: entityFlow.entryNodeId, status: "running", awaiting: false, visited: [], values: {}, binding: selectedEntity.binding };
    const answer = await processAgentTurn({ ...params, state: adapter, entityVersion: serviceVersion });
    const visual = answer.nextState.visual!;
    processes.service = { id: old?.id ?? randomUUID(), versionId: serviceVersion.id, visual, status: visual.status === "waiting" ? "active" : "completed", promptCurrent: visual.status === "waiting", fields: answer.nextState.fields, order: answer.nextState.context?.order ?? {} };
    state.context!.profile = answer.nextState.context?.profile ?? state.context!.profile; state.customer = answer.nextState.customer;
    if (JSON.stringify(state.context!.profile) !== oldProfile && processes.order) { processes.order.snapshot.execution.orderConfirmed = false; processes.order.snapshot.execution.awaitingOrderConfirmation = false; }
    state.visual = visual;
    processes.active = null; processes.promptOwner = null; delete processes.pendingChoice;
    const decision: ConversationRouting = { process: "information", action: old ? "continue" : "start", source: "rules", reason: `Vazhdon rrjedha e lidhur me ${selectedEntity.entity.name}.`, reusedFields: Object.keys(state.context!.profile), missingFields: [] };
    processes.lastDecision = decision; answer.nextState = state; answer.workflowId = null; answer.conversationRouting = decision;
    rememberTurn(params.state, state, params.message, answer.reply); return answer;
  }
  if (selectedEntity || freshEntityVersion || (!orderVisual && explicitIntent(entityMessage) === "order" && serviceVersion)) params = { ...params, entityVersion: serviceVersion };
  explicitProfile(state, params.message);
  const steps = state.context?.execution.linear?.steps ?? [];
  await extractMessageFacts(state, params.message, [...profileExtractionFields,
    ...steps.filter(step => !["confirm", "customer", "photo"].includes(step.kind)).map(step => ({ key: step.fieldKey ?? step.key, type: step.fieldType ?? "text" as const, label: step.label, options: step.options })),
    ...(graphVersion?.graph.nodes.filter(node => node.kind === "collect" && node.config.fieldKey).map(node => ({ key: node.config.fieldKey!, type: node.config.fieldType ?? "text" as const, label: node.label })) ?? [])]);
  if (params.hasPhoto && processes.active === "order") {
    const photoStep = steps.find(step => step.key === state.step_key && step.kind === "photo");
    const photoNode = graphVersion?.graph.nodes.find(node => node.id === state.visual?.nodeId && node.kind === "collect" && node.config.fieldType === "photo");
    const key = photoStep ? photoStep.fieldKey ?? photoStep.key : photoNode?.config.fieldKey;
    if (key) setFact(state, key, "photo_received", "photo", "message_attachment");
  }
  if (processes.active === "order" && processes.order) {
    if (!processes.auxiliary) processes.order.snapshot = snapshotOrder(state);
    else {
      processes.order.snapshot.order = structuredClone(state.context!.order);
      processes.order.snapshot.fields = { ...processes.order.snapshot.fields, ...state.fields };
      processes.order.snapshot.execution = structuredClone(state.context!.execution);
    }
  }
  if (JSON.stringify(state.context!.profile) !== oldProfile && processes.order) {
    processes.order.snapshot.execution.orderConfirmed = false;
    processes.order.snapshot.execution.awaitingOrderConfirmation = false;
  }
  let message = params.message;
  let replacementResolved = false;
  let replacementDeclined = false;
  let route = await routeMessage(message, state);
  if (serviceBooking) route = { process: "booking", source: "rules" };
  else if (productOrder) route = { process: "order", source: "rules" };
  const decision: ConversationRouting = { ...route, action: "continue", reason: "Mesazhi vazhdon procesin aktual.", reusedFields: [], missingFields: [] };
  const finish = (result: AgentTurnResult) => {
    result.nextState.schemaVersion = 3;
    result.nextState.processes = processes;
    result.conversationRouting = decision;
    processes.lastDecision = decision;
    rememberTurn(params.state, result.nextState, params.message, result.reply);
    params.onTrace?.({ stage: "workflow", label: "Conversation process selected", data: decision });
    return result;
  };
  const clarify = (reply: string) => {
    decision.process = "clarify"; decision.action = "clarify"; decision.reason = reply;
    processes.promptOwner = null;
    return finish(plainResult(state, reply));
  };
  if (processes.pendingChoice?.kind === "replace") {
    const pending = processes.pendingChoice;
    replacementResolved = true;
    if (affirmative(message)) {
      route = { process: pending.process!, source: "rules" };
      message = pending.message;
      if (pending.process === "order") { delete processes.order; state = resetOrder(state); }
      else delete processes.booking;
      delete processes.pendingChoice;
    } else if (/^(jo|no)[.!\s]*$/.test(foldText(message))) {
      replacementDeclined = true;
      route = { process: pending.process!, source: "rules" };
      message = pending.process === "order" ? "Vazhdo porosinë" : "Vazhdo rezervimin";
      delete processes.pendingChoice;
    } else return clarify("Të fillojmë kërkesën e re duke zëvendësuar të papërfunduarën, apo të vazhdojmë atë ekzistuese?");
  } else if (processes.pendingChoice?.kind === "process") {
    if (route.process !== "order" && route.process !== "booking") return clarify("Cilën të trajtojmë fillimisht: porosinë apo rezervimin?");
    message = `${processes.pendingChoice.message}\nTani vazhdo vetëm ${route.process === "order" ? "porosinë" : "rezervimin"}.`;
    delete processes.pendingChoice;
  }
  decision.process = route.process; decision.source = route.source;
  if (route.process === "clarify") {
    processes.pendingChoice = { kind: "process", message };
    return clarify("Cilën të trajtojmë fillimisht: porosinë apo rezervimin? Të dhënat që dhe ruhen.");
  }
  if ((route.process === "order" || route.process === "booking") && affirmative(message) && !processes.promptOwner) return clarify("Çfarë dëshiron të konfirmosh ose të vazhdosh: porosinë apo rezervimin?");
  const confirmation = namedConfirmation(message);
  if (confirmation) {
    const snapshot = processes.order?.snapshot;
    const awaiting = confirmation === "booking" ? processes.booking?.draft?.phase === "confirm"
      : snapshot?.execution.awaitingOrderConfirmation || snapshot?.step_key === "order_confirm"
        || snapshot?.execution.linear?.steps.some(step => step.key === snapshot.step_key && step.kind === "confirm")
        || graphVersion?.graph.nodes.some(node => node.id === snapshot?.visual?.nodeId && node.kind === "confirm");
    if (!awaiting) return clarify("Kërkesa ka ende të dhëna për t’u plotësuar përpara konfirmimit. Cilin proces dëshiron të vazhdosh?");
    message = "Konfirmoj";
  }
  if (route.process === "information") {
    if (processes.service) processes.service.promptCurrent = false;
    decision.action = "answer"; decision.reason = "Pyetja merr përgjigje; progresi i porosisë dhe rezervimit ruhet.";
    processes.promptOwner = null;
    const version = graphVersion;
    const entry = version?.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "information")?.entryNodeId : undefined;
    const knowledge = version?.graph.nodes.find(node => node.id === entry && node.kind === "knowledge") ?? version?.graph.nodes.find(node => node.kind === "knowledge");
    const configuredInformation = version?.graph.version === 2 && version.graph.flows.some(flow => flow.kind === "information");
    if (configuredInformation) {
      const adapter = structuredClone(state);
      adapter.visual = processes.auxiliary?.process === "information" ? processes.auxiliary.visual : undefined;
      // An informational subflow may collect its own details. Keep the order's pinned
      // cursor separately; only the shared facts cross back into that task.
      const answer = await processAgentTurn({ ...params, state: adapter, informationRequest: true });
      if (answer.nextState.visual?.status === "waiting") processes.auxiliary = { process: "information", visual: answer.nextState.visual };
      else {
        delete processes.auxiliary;
        answer.nextState.visual = processes.active === "order" ? processes.order?.snapshot.visual : processes.active === "booking" ? processes.booking?.visual : undefined;
      }
      if (processes.order && answer.nextState.context) {
        processes.order.snapshot.order = { ...processes.order.snapshot.order, ...answer.nextState.context.order };
        for (const [key, fact] of Object.entries(answer.nextState.context.order)) processes.order.snapshot.fields[key] = fact.type === "photo" ? true : fact.value;
      }
      return finish(answer);
    }
    const answer = await processLegacyAgentTurn({ ...params, state, informational: `Answer this informational question using verified business information. Preserve every unfinished task. Do not confirm or perform an action and do not repeat the previous workflow question.${knowledge?.config.prompt ? ` Configured informational workflow guidance: ${knowledge.config.prompt}` : ""}` });
    answer.nextState = state;
    return finish(answer);
  }
  if (route.process === "support") {
    if (processes.service) processes.service.promptCurrent = false;
    decision.action = "answer"; decision.reason = "Klienti kërkon ndihmë; proceset e papërfunduara mbeten të ruajtura.";
    if (processes.active) {
      const task = processes[processes.active]; if (task) task.status = "suspended";
      decision.suspended = processes.active;
    }
    processes.active = null; processes.promptOwner = null;
    if (state.visual?.status === "handoff" && contactChannel(message)) {
      const result = await processLegacyAgentTurn({ ...params, state, informational: "The customer selected a contact channel after being referred to staff. Give the business contact for that channel only when explicitly present in verified business knowledge. If unavailable, clearly say that contact detail is unavailable. Never substitute customer contact data, ask which workflow step to edit, or claim staff has already responded." });
      result.nextState = state; result.handoff = true; result.advisoryHandoff = true;
      return finish(result);
    }
    const result = await processAgentTurn({ ...params, state });
    if (result.nextState.visual?.status === "waiting") processes.auxiliary = { process: "support", visual: result.nextState.visual };
    else delete processes.auxiliary;
    // Routing to staff must not replace the saved order task with the handoff cursor.
    result.advisoryHandoff = result.handoff ? true : result.advisoryHandoff;
    return finish(result);
  }
  const target = route.process;
  if (processes.service?.status === "active") processes.service.status = "suspended";
  delete processes.auxiliary;
  if (target === "booking" && processes.booking?.status === "completed") delete processes.booking;
  const task = processes[target];
  const changedBookedService = target === "booking" && serviceBooking && selectedEntity && processes.booking?.draft?.serviceId && processes.booking.draft.serviceId !== selectedEntity.entity.id;
  if (task && task.status !== "completed" && (newRequest(foldText(message), target) || changedBookedService) && !replacementResolved) {
    processes.pendingChoice = { kind: "replace", process: target, message };
    return clarify(`Ke një ${target === "order" ? "porosi" : "rezervim"} të papërfunduar. Ta zëvendësojmë me kërkesën e re? Shkruaj “Po” ose “Jo”.`);
  }
  const previousActive = processes.active;
  if (previousActive && previousActive !== target) {
    const previousTask = processes[previousActive];
    if (previousTask && previousTask.status !== "completed") { previousTask.status = "suspended"; decision.suspended = previousActive; }
  }
  decision.action = task?.status === "suspended" || (task && previousActive !== target) ? "resume" : task?.status === "active" ? "continue" : "start";
  if (decision.action === "resume") decision.resumed = target;
  decision.reason = decision.action === "resume" ? `Rifillon ${target === "order" ? "porosia" : "rezervimi"} me të dhënat e ruajtura.` : `Mesazhi i përket ${target === "order" ? "porosisë" : "rezervimit"}.`;
  decision.reusedFields = Object.keys(state.context!.profile).map(key => `customer_${key}`);
  if (target === "booking") {
    if (params.canAct && !(await params.canAct())) throw new Error("conversation_manually_paused");
    const adapter = bookingAdapterState(state);
    const bookingVersion = processes.booking?.versionId ? params.visualPreview ?? await loadVisualVersion(params.businessId, processes.booking.versionId)
      : params.entityVersion !== undefined ? params.entityVersion : params.visualPreview ?? (processes.booking ? graphVersion : await loadVisualVersion(params.businessId));
    const bookingTurn = (bookingState: ConversationStatePayload) => processBookingTurn({ businessId: params.businessId, message, state: bookingState, mode: params.mode,
      conversationKey: params.conversationKey, onTrace: params.onTrace, routed: true, resume: decision.action === "resume",
      bookingGuard: params.bookingGuard, canAct: params.canAct, selectedServiceId: bookingState.visual?.binding?.entity.kind === "service" ? bookingState.visual.binding.entity.id : undefined });
    const configuredBooking = (Boolean(serviceBooking) || Boolean(processes.booking?.visual?.binding) || bookingVersion?.graph.version !== 2 || bookingVersion.graph.flows.some(flow => flow.kind === "booking")) && !(params.entityVersion === null && !processes.booking);
    const result = !configuredBooking ? null : bookingVersion?.graph.nodes.some(node => node.kind === "booking")
      ? await processAgentTurn({ ...params, message, state: adapter, entityVersion: bookingVersion ?? undefined, bookingRequest: true, bookingNavigation: decision.action === "resume" || bookingRequest(foldText(message)), bookingTurn })
      : await bookingTurn(adapter);
    if (!result) {
      // Disabled capability cannot consume an unrelated pending field or discard its task.
      decision.process = "information"; decision.action = "answer"; decision.reason = "Rezervimi automatik nuk është i aktivizuar për këtë biznes.";
      processes.active = previousActive; if (previousActive && processes[previousActive]) processes[previousActive]!.status = "active";
      processes.promptOwner = null;
      return finish(plainResult(state, "Për rezervimin, kontakto stafin e biznesit. Mund të vazhdojmë edhe kërkesën që ke nisur."));
    }
    const draft = result.nextState.fields.booking as BookingDraft | undefined;
    const waiting = Boolean(draft || result.nextState.visual?.status === "waiting");
    processes.booking = { id: task?.id ?? draft?.nonce ?? randomUUID(), status: waiting ? "active" : "completed", draft,
      versionId: processes.booking?.versionId ?? bookingVersion?.id, visual: result.nextState.visual };
    processes.active = waiting ? "booking" : null; processes.promptOwner = waiting ? "booking" : null;
    result.nextState.processes = processes;
    decision.missingFields = draft ? ["serviceId", "date", "time", "name"].filter(key => !draft[key as keyof BookingDraft]).map(key => `booking.${key}`) : [];
    if (informationalQuestion(foldText(message))) {
      const answer = await processLegacyAgentTurn({ ...params, state: result.nextState, informational: "Answer only the informational question using verified business information; no actions or confirmation. The separate booking response will follow." });
      result.reply = `${answer.reply}\n\n${result.reply}`;
    }
    return finish(result);
  }
  if (processes.order?.status === "completed") { delete processes.order; state = resetOrder(state); }
  else if (processes.order) state = restoreOrder(state);
  else if (freshEntityVersion && state.visual?.binding && (!selectedEntity || selectedEntity.binding.flowId !== state.visual.binding.flowId || params.entityVersion?.id !== state.visual.versionId)) delete state.visual;
  let usedBookingNode = false;
  if (replacementDeclined) params = { ...params, entityVersion: undefined };
  const result = await processAgentTurn({ ...params, message, state, orderRequest: decision.action === "resume" || resumeOrder(foldText(message)) || explicitIntent(message) === "order",
    bookingTurn: async bookingState => {
      const adapter = bookingAdapterState(bookingState);
      const booking = await processBookingTurn({ businessId: params.businessId, message, state: adapter, mode: params.mode,
        conversationKey: params.conversationKey, onTrace: params.onTrace, routed: true, bookingGuard: params.bookingGuard, canAct: params.canAct,
        selectedServiceId: bookingState.visual?.binding?.entity.kind === "service" ? bookingState.visual.binding.entity.id : undefined });
      usedBookingNode = Boolean(booking);
      return booking;
    } });
  if (usedBookingNode) {
    const draft = result.nextState.fields.booking as BookingDraft | undefined;
    if (processes.order?.status === "active") { processes.order.status = "suspended"; decision.suspended = "order"; }
    processes.booking = { id: processes.booking?.id ?? draft?.nonce ?? randomUUID(), status: draft ? "active" : "completed", draft,
      versionId: result.nextState.visual?.versionId, visual: result.nextState.visual };
    processes.active = draft ? "booking" : null; processes.promptOwner = draft ? "booking" : null;
    decision.process = "booking"; decision.reason = "Rrjedha e konfiguruar kaloi te rezervimi.";
    return finish(result);
  }
  if (result.nextState.processes?.pendingChoice?.kind === "replace") {
    processes.pendingChoice = result.nextState.processes.pendingChoice;
    return clarify(result.reply);
  }
  if (informationalQuestion(foldText(message))) {
    const answer = await processLegacyAgentTurn({ ...params, state: result.nextState, informational: "Answer only the informational question using verified business information; no actions or confirmation. The separate order response will follow." });
    result.reply = `${answer.reply}\n\n${result.reply}`;
  }
  const completed = result.nextState.step_key === "order_ready";
  processes.order = { id: processes.order?.id ?? randomUUID(), status: completed ? "completed" : "active", snapshot: snapshotOrder(result.nextState) };
  processes.active = completed ? null : "order"; processes.promptOwner = completed ? null : "order";
  decision.missingFields = result.workflowProgress.filter(step => step.status !== "done").map(step => step.key);
  return finish(result);
}
