import { isStaffContactRequest, staffContactInstructions, staffHandoffReply } from "./handoff";
import { CapabilityEnforcementError, requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { clarificationChoice, clarificationTarget, conversationControl, explicitContinuation, resumeClarificationPrompt, resumeConversation } from "./conversation-control";
import { usesSharedCoordinator } from "./coordinator-policy";
import { randomUUID } from "node:crypto";
import { processBookingTurn, type BookingDraft } from "@/lib/calendar/agent";
import type { BookingEffectGuard } from "@/lib/calendar/service";
import { agentModel } from "@/lib/agents/generate";
import { processAgentTurn as executeAgentTurn, processLegacyAgentTurn as executeLegacyTurn, type AgentTurnParams, type AgentTurnResult } from "./process-agent-turn";
import { collectionInput, decisionForTurn, turnIntent, type CollectionTarget, type TurnDecision, type TurnEntity } from "./turn-decision";
import { emptyState, foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { affirmative, extractExplicitFacts, invalidateOrderReview, isQuestion, migrateContext, resetOrder, setFact } from "@/lib/workflows/context";
import { extractMessageFacts, profileExtractionFields } from "@/lib/workflows/extract-facts";
import { chooseGuidance, explicitIntent, recentConversation, rememberTurn } from "@/lib/workflows/guidance";
import { bookingAdapterState, currentProcessOwner, migrateConversationProcesses, restoreOrder, snapshotOrder, suspendProcesses, type ConversationRouting, type LocalProcessKind, type ProcessKind } from "@/lib/workflows/conversation-processes";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import { customerOrderStatus, isOrderStatusFollowUp, isOrderStatusRequest, readOrderStatusLookup, setOrderStatusLookup, type OrderCustomerIdentity } from "@/lib/orders/customer-status";
import { isEntityInformationRequest, resolveVisualEntity } from "@/lib/workflows/visual/entity-routing";
import { ownedCollectNodes, pendingCollectNode } from "@/lib/workflows/visual/facts";
import { combineProductPresentations, isBareCollectionValue, isEntityReference, recordReplyPresentation, referenceEntityKind } from "@/lib/products/entity-bridge";
import { resolveCurrentProductReference, resolveCurrentServiceReference } from "@/lib/products/resolve-reference";
import {
  IsolationViolation,
  isIsolatedExecution,
  recordExternalAction,
  snapshotExternalActions,
} from "@/lib/runtime/execution-context";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { readContext as readCatalogContext } from "@/lib/catalogs/ranking";

export type ConversationMessageParams = AgentTurnParams & {
  /** Server webhook identity, never accepted from chat text or preview state. */
  customerIdentity?: OrderCustomerIdentity;
  conversationKey?: string;
  bookingGuard?: BookingEffectGuard;
  /** Production adapter rechecks manual ownership immediately before booking effects. */
  canAct?: () => Promise<boolean>;
};
type Route = Pick<ConversationRouting, "process" | "source"> & { clarification?: string };
const namedConfirmation = (message: string): ProcessKind | null => { const match = foldText(message).match(/^(?:po )?(?:e )?konfirmoj (porosine|rezervimin)[.!\s]*$/); return match ? match[1] === "porosine" ? "order" : "booking" : null; };
const contactChannel = (message: string) => /^(?:whatsapp|telefon|phone|instagram)[.!\s]*$/.test(foldText(message));
const contactFollowUp = (message: string, state: ConversationStatePayload) => (state.visual?.status === "handoff" || state.processes?.lastDecision?.process === "support")
  && (contactChannel(message) || (!state.processes?.lastDecision || state.processes.lastDecision.process === "support")
    && /^(?:ku|si|ne cilin numer|cili numer|where|how)[?!.\s]*$/.test(foldText(message)));
const bookingRequest = (text: string) => /\b(rezerv\w*|takim\w*|appointment|booking|termin|orar\w* (?:te )?lir\w*)\b/.test(text);
const informationalQuestion = (text: string) => /\b(sa kushton|cmimi|price|ku ndodhe|ku jeni|kur hap|orar(?:i)? (?:i punes|punes)|si pagu|pagesa|sa zgjat|what.*cost|how much)\b/.test(text);
const resumeOrder = (text: string) => /\b(vazhdo\w*|ktheh\w*|rifill\w*|resume)\b.*\b(porosi\w*|order)\b/.test(text);
const newRequest = (text: string, kind: ProcessKind) => kind === "order" ? /\b(porosi (?:te |nje )?re|porosi tjeter|new order|another order)\b/.test(text) : /\b(rezervim (?:te |nje )?ri|rezervim tjeter|takim tjeter|new booking|another booking)\b/.test(text);

// An answer to a pending field may follow an informational detour. This is not
// prompt ownership: short approvals still pass the delivery/freshness gate first.
function interruptedProcess(state: ConversationStatePayload): LocalProcessKind | null {
  const p = state.processes, last = p?.lastDecision;
  return !state.conversationPaused && !p?.informationOnly && !p?.auxiliary && last?.process === "information" && last.action === "answer"
    && last.suspended && p?.[last.suspended] ? last.suspended : null;
}

async function routeMessage(message: string, state: ConversationStatePayload): Promise<Route> {
  const text = foldText(message), intent = explicitIntent(message);
  const meaning = turnIntent(message);
  const confirmation = namedConfirmation(message);
  if (confirmation) return { process: confirmation, source: "rules" };
  if (contactFollowUp(message, state) || isStaffContactRequest(message) && intent !== "order") return { process: "support", source: "rules" };
  // Managing an already persisted appointment remains a staff action.
  if (/\b(ndrysho\w*|anulo\w*|cancel|reschedule)\b/.test(text) && bookingRequest(text) && /\b(ekzistues\w*|konfirmuar|mepar\w*|existing|confirmed)\b/.test(text)) return { process: "support", source: "rules" };
  const order = meaning === "order" || resumeOrder(text) || /^(porosia|porosine|order)[.!\s]*$/.test(text);
  if (meaning === "information") return { process: "information", source: "rules" };
  if (informationalQuestion(text) && !order && !/\b(dua|kerkoj|rezervo|book|want|vazhdo|rifillo)\b/.test(text)) return { process: "information", source: "rules" };
  const booking = bookingRequest(text) && !/\b(nuk dua|s dua|do not want)\b/.test(text);
  const bookingAction = booking && /\b(dua|kerkoj|rezervo\w*|book|want|vazhdo\w*|rifillo\w*)\b/.test(text);
  if (isQuestion(message) && !order && !bookingAction && intent !== "support" && !/\b(ndrysho\w*|korrigjo\w*)\b/.test(text)) return { process: "information", source: "rules" };
  if (order && booking) return { process: "clarify", source: "rules" };
  if (order) return { process: "order", source: "rules" };
  if (booking) return { process: "booking", source: "rules" };
  if (intent === "support") return { process: "support", source: "rules" };
  if (state.processes?.informationOnly) return { process: "information", source: "rules" };
  if (isQuestion(message) && !/\b(ndrysho\w*|korrigjo\w*)\b/.test(text)) return { process: "information", source: "rules" };
  if (affirmative(message) || /^(jo|no)[.!\s]*$/.test(text)) return { process: state.processes!.auxiliary?.process ?? state.processes!.active ?? "information", source: "rules" };
  const interrupted = interruptedProcess(state);
  const active = state.processes!.active ?? (interrupted === "order" || interrupted === "booking" ? interrupted : null);
  const auxiliary = state.processes!.auxiliary;
  const lastReply = state.recentMessages?.filter(message => message.role === "assistant").at(-1)?.content;
  const pendingStep = active === "order" ? state.context?.execution.linear?.steps.find(step => step.key === state.step_key) : undefined;
  const guidance = await chooseGuidance({ message, state, targets: [],
    current: auxiliary ? { id: auxiliary.visual.nodeId, label: "Vazhdimi i bisedës", prompt: lastReply, kind: auxiliary.process }
      : active ? { id: active, label: pendingStep?.label ?? (active === "booking" ? "Plotësimi i rezervimit" : "Plotësimi i porosisë"), kind: active,
          fieldKey: pendingStep?.fieldKey ?? pendingStep?.key, prompt: lastReply ?? pendingStep?.prompt }
        : lastReply ? { id: "conversation", label: "Vazhdimi i bisedës", prompt: lastReply, kind: "information" } : undefined,
    routes: [{ id: "order", label: "Nis ose rifillo porosinë e produktit", kind: "product" }, { id: "booking", label: "Nis ose rifillo rezervimin e shërbimit", kind: "booking" }],
    allowOrder: true, allowSupport: false,
  });
  if (guidance.action === "route" && guidance.target === "booking") return { process: "booking", source: guidance.source };
  if (guidance.action === "order" || (guidance.action === "route" && guidance.target === "order")) return { process: "order", source: guidance.source };
  if (guidance.action === "answer") return { process: "information", source: guidance.source };
  // Detailed corrections/backtracking are handled by the selected process's existing guidance engine.
  // Without a pending task, ambiguous text is ordinary conversation. Let the
  // business agent greet/clarify instead of inventing a request to edit a workflow.
  if (guidance.action === "clarify" && !active && (!auxiliary && !state.processes!.pendingChoice || state.visual?.status === "handoff")) return { process: "information", source: guidance.source };
  if (guidance.action === "clarify") return { process: "clarify", source: guidance.source, clarification: "Çfarë dëshiron të ndryshosh ose të vazhdosh?" };
  // A conversational answer is not an implicit purchase. Only a selected order
  // intent or an existing active task may enter the product collection engine.
  return { process: auxiliary?.process ?? active ?? "information", source: guidance.source };
}

function plainResult(state: ConversationStatePayload, reply: string): AgentTurnResult {
  return { reply, nextState: state, previousResponseId: null, workflowId: state.context?.execution.linear?.id ?? null,
    productName: null, workflowProgress: [], debug: { model: agentModel(), source: "fallback", fallbackReason: "conversation_routing", agentConfigured: true,
      knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
function entityClarification(state: ConversationStatePayload, reply: string): AgentTurnResult {
  suspendProcesses(state);
  return { ...plainResult(state, reply), conversationRouting: { process: "clarify", action: "clarify", source: "rules", reason: reply, reusedFields: [], missingFields: [] } };
}
function explicitProfile(state: ConversationStatePayload, message: string, profileOnly = false) {
  extractExplicitFacts(state, message, profileOnly ? [] : state.context?.execution.linear?.steps ?? []);
  // Contact labels anchor the number to this customer's own statement, including mixed question/fact turns.
  const phone = message.match(/(?:telefoni?\s*(?:im)?|numri\s+im|my\s+(?:phone|number))\s*(?:(?:është|eshte|is)\s*|[:=]\s*)(\+?[\d ().-]{7,24}\d)/i);
  if (phone) setFact(state, "customer_phone", phone[1].trim(), "phone", "message_phone");
}

function isolatedTurn(params: ConversationMessageParams) {
  return params.source === "admin_chat_lab" || params.mode === "test"
    || Boolean(params.visualPreview) || Boolean(params.linearPreview);
}

function lockIsolatedParams(params: ConversationMessageParams): ConversationMessageParams {
  // Isolation is server-owned. Model output and workflow config cannot select live adapters.
  if (isolatedTurn(params) || isIsolatedExecution()) return { ...params, mode: "test" };
  return params;
}

function attachTurnEffects(result: AgentTurnResult): AgentTurnResult {
  const actions = snapshotExternalActions();
  if (actions.length) result.externalActions = actions;
  else delete result.externalActions;
  return result;
}

/** One message coordinator for Instagram, isolated chat and graph previews. Adapters own persistence/send. */
export async function processConversationMessage(params: ConversationMessageParams): Promise<AgentTurnResult> {
  params = lockIsolatedParams(params);
  if (isolatedTurn(params) && !isIsolatedExecution()) {
    return runIsolated(() => processConversationMessage(params));
  }
  const started = Date.now();
  const before = { ...emptyState(), recentMessages: recentConversation(params.state) };
  const scope: DecisionScope = {};
  let result: AgentTurnResult;
  try {
    result = await processMessage({ ...params, actionGuard: params.bookingGuard }, scope);
    if (result.handoff) await requireRuntimeModules(params.businessId, ["staff"]);
  } catch (error) {
    if (error instanceof IsolationViolation) throw error;
    if (!(error instanceof CapabilityEnforcementError)) throw error;
    params.onTrace?.({ stage: "workflow", label: "Runtime capability blocked", status: "skipped", data: {
      businessId: params.businessId, executionMode: isIsolatedExecution() ? "isolated" : "live",
      reasonCode: error.code, validation: "not_executed", currentNodeId: params.state?.visual?.nodeId ?? null,
    } });
    // Retain the original pinned version, collected fields and process cursors.
    result = plainResult(structuredClone(params.state ?? emptyState()), error.message);
    result.workflowId = params.persistedWorkflowId ?? params.state?.context?.execution.linear?.id ?? params.state?.linearSnapshot?.id ?? null;
    scope.decision = { ...decisionForTurn({ message: params.message, state: params.state, executor: "coordinator" }), kind: "blocked", reason: "capability" };
  }
  result.turnDecision = result.turnDecision && ["blocked", "clarification"].includes(result.turnDecision.kind) ? result.turnDecision : scope.decision ?? decisionForTurn({ message: params.message, state: params.state,
    routing: result.conversationRouting, executor: "coordinator", entity: scope.entity, field: scope.field });
  params.onTrace?.({ stage: "workflow", label: "Conversation turn decision", data: result.turnDecision });
  if (result.handoff && !result.advisoryHandoff) {
    result.nextState.staffHandoff = true;
    if (isIsolatedExecution()) {
      recordExternalAction({ kind: "staff.handoff", disposition: "SIMULATED", detail: "test_state_only" });
    }
  }
  if (isIsolatedExecution() && result.nextState.step_key === "order_ready" && params.state?.step_key !== "order_ready") {
    recordExternalAction({ kind: "order.create", disposition: "SIMULATED", detail: "not_submitted" });
  }
  // Always rebuild from the inbound history. Nested processors may have recorded
  // an intermediate reply; the coordinator owns the final pair, exactly once.
  if (result.presentedProducts?.length || result.presentedServices?.length) result.nextState = structuredClone(result.nextState);
  recordReplyPresentation(result.nextState, params.businessId, result);
  rememberTurn(before, result.nextState, params.message, result.reply);
  if (result.conversationRouting) {
    if (result.nextState.processes) result.nextState.processes.lastDecision = result.conversationRouting;
    params.onTrace?.({ stage: "workflow", label: "Conversation process selected", data: result.conversationRouting });
  }
  // Operational metadata only: never copy messages, profile values or lease tokens.
  params.onTrace?.({ stage: "workflow", label: "Conversation coordinator completed", data: {
    coordinator: params.linearPreview ? "linear_preview" : usesSharedCoordinator(params) ? "shared_v3" : "legacy",
    businessId: params.businessId, executionMode: isIsolatedExecution() ? "isolated" : "live",
    channel: params.source ?? (params.mode === "test" ? "admin_chat_lab" : "instagram"),
    revision: params.bookingGuard?.revision ?? null,
    workflowVersion: result.nextState.visual?.versionId ?? result.nextState.context?.execution.linear?.versionId ?? null,
    process: result.conversationRouting?.process ?? null,
    action: result.conversationRouting?.action ?? null,
    elapsedMs: Date.now() - started,
  } });
  return attachTurnEffects(result);
}

type DecisionScope = { decision?: TurnDecision; entity?: TurnEntity; field?: CollectionTarget; routing?: ConversationRouting; process?: LocalProcessKind };
async function processMessage(params: ConversationMessageParams, scope: DecisionScope): Promise<AgentTurnResult> {
  // Seal one semantic decision at dispatch. Nested informational replies reuse
  // it; they cannot replace the customer's process intent. Executor guards remain.
  const dispatch = (input: AgentTurnParams, executor: TurnDecision["executor"], informational = false) => {
    scope.decision ??= decisionForTurn({ message: params.message, state: params.state,
      routing: scope.routing, executor, entity: scope.entity ?? (input.selectedProductId ? { status: "resolved", kind: "product", id: input.selectedProductId } : undefined),
      field: input.selectedProductId ? undefined : scope.field, process: scope.process ?? (input.actionFlowRequest ? "actionFlow" : input.bookingRequest ? "booking" : undefined),
      versionId: input.state?.visual?.versionId ?? input.entityVersion?.id ?? input.visualPreview?.id,
      intent: informational || input.informationRequest ? "information" : turnIntent(params.message) });
    return { ...input, turnDecision: scope.decision,
      ...(scope.entity?.status === "resolved" && scope.entity.kind === "service" && !informational
        ? { selectedServiceId: scope.entity.id } : {}) };
  };
  const processAgentTurn = (input: AgentTurnParams) => executeAgentTurn(dispatch(input, "workflow"));
  const processLegacyAgentTurn = (input: Parameters<typeof executeLegacyTurn>[0]) => executeLegacyTurn({ ...input, ...dispatch(input, "legacy_information", input.informational !== undefined) });
  if (params.canAct && !(await params.canAct())) throw new Error("conversation_manually_paused");
  if (params.linearPreview && (params.mode !== "test" || !params.state?.context?.execution.linear?.versionId.startsWith("linear-preview:"))) throw new Error("invalid_linear_preview");
  const migrateState = async () => {
    // Classify old snapshots against their pinned version, never today's graph.
    const pinned = !params.state?.processes && params.state?.visual
      ? params.visualPreview ?? await loadVisualVersion(params.businessId, params.state.visual.versionId)
      : undefined;
    return migrateConversationProcesses(params.state, randomUUID, pinned);
  };
  let clarificationResume: LocalProcessKind | undefined;
  const choice = !params.hasPhoto && !params.hasAttachments ? clarificationChoice(params.message) : null;
  if (params.state?.staffHandoff || params.state?.visual?.status === "handoff" && !params.state.visual.advisory) {
    const state = structuredClone(params.state);
    suspendProcesses(state);
    if (state.processes) delete state.processes.pendingClarification;
    return { ...plainResult(state, "Biseda është në pritje të stafit. Kjo përgjigje nuk rifillon dhe nuk konfirmon kërkesën."),
      conversationRouting: { process: "support", action: "answer", source: "rules", reason: "clarification_staff_owned", reusedFields: [], missingFields: [] } };
  }
  if (!params.state?.processes && params.state?.visual && usesSharedCoordinator(params)) params = { ...params, state: await migrateState() };
  if (params.state?.conversationPaused || params.state?.processes?.pendingClarification || choice === "resume" || choice === "cancel"
    || choice && params.state?.processes?.lastDecision?.reason.startsWith("clarification_")) {
    let state = await migrateState();
    const processes = state.processes!;
    const pending = processes.pendingClarification;
    const respond = (reply: string, reason: string) => ({ ...plainResult(state, reply),
      conversationRouting: { process: "information" as const, action: "answer" as const, source: "rules" as const, reason, reusedFields: [], missingFields: [] } });
    // A repeated navigation reply must not become input to the newly displayed field.
    // Transport event deduplication remains authoritative; this only handles repeated choice text.
    const previousUser = state.recentMessages?.at(-2), previousReply = state.recentMessages?.at(-1);
    if (choice && !pending && processes.lastDecision?.reason === `clarification_${choice}` && previousUser?.role === "user"
      && clarificationChoice(previousUser.content) === choice && previousReply?.role === "assistant") {
      return respond(previousReply.content, `clarification_${choice}`);
    }
    if (choice === "information") {
      suspendProcesses(state);
      delete processes.pendingChoice; delete processes.pendingClarification; delete processes.auxiliary;
      processes.informationOnly = true;
      state.conversationPaused = true;
      return respond("Në rregull, vetëm informacion. Çfarë dëshiron të dish?", "clarification_information");
    }
    if (choice === "resume" || choice === "cancel") {
      const target = pending?.target;
      const current = target && clarificationTarget(state, target.process);
      const currentPrompt = previousReply?.role === "assistant" && previousReply.content === resumeClarificationPrompt;
      const delivered = params.mode === "test" || params.deliveredReply === resumeClarificationPrompt;
      const currentChoice = pending?.kind === "resume_process" && Number.isFinite(pending.expiresAt) && pending.expiresAt > Date.now()
        && state.conversationPaused && currentPrompt && delivered;
      const valid = currentChoice && target && current
        && target.id === current.id && target.versionId === current.versionId && target.cursor === current.cursor;
      delete processes.pendingClarification;
      if (choice === "cancel" && currentChoice && !target) {
        processes.informationOnly = true;
        return respond("Në rregull, e mbyllëm sqarimin. Kërkesat e ruajtura nuk u ndryshuan.", "clarification_cancel");
      }
      if (!valid) return respond("Zgjedhja e mëparshme nuk është më e vlefshme ose nuk ka një kërkesë të vetme për të vazhduar. Shkruaj qartë cilën kërkesë dëshiron; nuk u krye asnjë veprim.", "clarification_stale");
      const process = target.process;
      suspendProcesses(state);
      delete processes.pendingChoice; delete processes.auxiliary;
      if (choice === "cancel") {
        if (process === "order") {
          const booking = state.fields.booking;
          state = resetOrder(state);
          if (booking) state.fields.booking = booking;
          delete processes.order;
        } else if (process === "booking") {
          const visual = processes.booking?.visual;
          delete processes.booking; delete state.fields.booking;
          if (visual && state.visual?.versionId === visual.versionId && state.visual.nodeId === visual.nodeId) delete state.visual;
          if (state.step_key === "booking_request") state.step_key = "choose_product";
        } else {
          const visual = processes[process]!.visual;
          delete processes[process];
          if (state.visual?.versionId === visual.versionId && state.visual.nodeId === visual.nodeId) delete state.visual;
        }
        state.conversationPaused = true;
        processes.informationOnly = true;
        return respond("Në rregull, e hoqëm kërkesën e papërfunduar nga kjo bisedë. Asnjë porosi ose rezervim i ruajtur nuk u anulua.", "clarification_cancel");
      }
      delete processes.informationOnly;
      if (process === "order") state = restoreOrder(state, { resume: true });
      delete state.conversationPaused;
      // Navigation only: reuse the existing resume route, never pass the choice as a field or confirmation.
      params = { ...params, state, message: process === "order" ? "Vazhdo porosinë" : process === "booking" ? "Vazhdo rezervimin" : "" };
      clarificationResume = process;
    } else {
      // Another topic invalidates the old choice. Ambiguous short answers keep it open.
      if (isQuestion(params.message) || explicitIntent(params.message) === "order" || explicitIntent(params.message) === "support") delete processes.pendingClarification;
      params = { ...params, state };
    }
  }
  // The same explicit resume contract applies to saved custom/service flows.
  // Resolve their names against pinned definitions, never a newly published graph.
  if (!clarificationResume && (params.state?.conversationPaused || params.state?.processes?.informationOnly)
    && !choice && !isQuestion(params.message) && /\b(vazhdo\w*|rifillo\w*|resume)\b/.test(foldText(params.message))) {
    const matches: LocalProcessKind[] = [];
    for (const kind of ["actionFlow", "service"] as const) {
      const task = params.state.processes?.[kind];
      if (!task || !clarificationTarget(params.state, kind)) continue;
      const version = params.visualPreview ?? await loadVisualVersion(params.businessId, task.versionId);
      if (version?.id !== task.versionId || version.graph.version !== 2) continue;
      const flow = version.graph.flows.find(f => f.nodeIds.includes(task.visual.nodeId));
      const namedFlow = flow?.label && foldText(params.message).includes(foldText(flow.label));
      const entity = kind === "service" && !namedFlow ? await resolveVisualEntity(params.businessId, version.graph, params.message, undefined, params.mode === "test", { state: params.state, deliveredReply: params.deliveredReply }) : undefined;
      if (namedFlow || entity?.mentioned && entity.mentioned.id === task.visual.binding?.entity.id && entity.mentioned.kind === task.visual.binding?.entity.kind && entity.selected)
        matches.push(kind);
    }
    if (matches.length === 1) {
      const state = structuredClone(params.state);
      suspendProcesses(state);
      delete state.conversationPaused; delete state.processes!.informationOnly; delete state.processes!.pendingClarification;
      clarificationResume = matches[0];
      params = { ...params, state, message: "" };
    }
  }
  const controlled = conversationControl(params);
  if (controlled) return controlled;
  params = resumeConversation(params);
  const owner = params.state && currentProcessOwner(params.state);
  const cursor = owner === "service" || owner === "actionFlow" || owner === "booking" ? params.state?.processes?.[owner]?.visual
    : params.state?.processes?.auxiliary?.visual ?? params.state?.visual;
  const pendingVersion = cursor?.status === "waiting" && cursor.awaiting
    ? params.visualPreview ?? await loadVisualVersion(params.businessId, cursor.versionId) : null;
  const collect = pendingVersion ? pendingCollectNode(pendingVersion.graph, cursor) : undefined;
  const linear = !owner || owner === "order" ? params.state?.context?.execution.linear?.steps.find(step => step.key === params.state?.step_key && !["confirm", "photo"].includes(step.kind)) : undefined;
  if (!params.state?.conversationPaused && !params.state?.processes?.informationOnly && !params.state?.processes?.pendingChoice && !params.state?.processes?.pendingClarification) {
    scope.field = collect?.config.fieldKey ? { key: collect.config.fieldKey, type: collect.config.fieldType ?? "text" }
      : linear ? { key: linear.fieldKey ?? linear.key, type: linear.fieldType ?? "text", options: linear.options } : undefined;
    const input = collectionInput(params.message, scope.field);
    if (input !== undefined) params = { ...params, message: input };
  }
  const replacementId = params.state?.processes?.pendingChoice?.kind === "replace" && affirmative(params.message)
    ? params.state.processes.pendingChoice.productId : undefined;
  const replacementServiceId = params.state?.processes?.pendingChoice?.kind === "replace" && affirmative(params.message)
    ? params.state.processes.pendingChoice.serviceId : undefined;
  const serviceReference = Boolean(replacementServiceId) || referenceEntityKind(params.message, params.state) === "service";
  if (serviceReference && (replacementServiceId || isEntityReference(params.message) && !params.state?.processes?.pendingChoice)
    && !params.state?.staffHandoff && !(params.state?.visual?.status === "handoff" && !params.state.visual.advisory)) {
    const reference = await resolveCurrentServiceReference({ businessId: params.businessId, message: params.message,
      state: params.state, deliveredReply: params.deliveredReply, mode: params.mode, collectingField: scope.field?.type, verifiedId: replacementServiceId });
    if (reference.status === "clarify") {
      scope.entity = { status: "unresolved", kind: "service" };
      const state = await migrateState();
      if (replacementServiceId) delete state.processes!.pendingChoice;
      return entityClarification(state, reference.reply);
    }
    if (reference.status === "selected") {
      scope.entity = { status: "resolved", kind: "service", id: reference.service.id };
      const booking = Boolean(replacementServiceId) || turnIntent(params.message) === "booking" || params.state?.processes?.active === "booking" && turnIntent(params.message) !== "information";
      params = { ...params, selectedServiceId: reference.service.id, informationRequest: !booking };
    }
  }
  // Resolve the customer's reference before guidance or old visual bindings can
  // turn it into an answer to a different process field. W1 control has priority.
  if (!params.state?.staffHandoff && !(params.state?.visual?.status === "handoff" && !params.state.visual.advisory)
    && (!params.state?.processes?.informationOnly || explicitIntent(params.message) === "order")
    && (!params.state?.processes?.pendingChoice || replacementId)
    && (turnIntent(params.message) === "order" || !isQuestion(params.message))
    && !serviceReference && !bookingRequest(foldText(params.message)) && explicitIntent(params.message) !== "support"
    && (replacementId || params.state?.entityPresentation || isEntityReference(params.message))) {
    const cursor = params.state?.visual;
    const referenceVersion = cursor ? params.visualPreview ?? await loadVisualVersion(params.businessId, cursor.versionId) : null;
    const pendingField = referenceVersion ? pendingCollectNode(referenceVersion.graph, cursor) : undefined;
    const collectingField = pendingField ? pendingField.config.fieldType ?? "text" : undefined;
    // A typed reply needs no product lookup. In particular, an old catalog list
    // must not impose product permissions on the current service/booking field.
    const reference = !replacementId && isBareCollectionValue(params.message, collectingField) ? { status: "none" as const }
      : await resolveCurrentProductReference({ businessId: params.businessId, message: params.message, state: params.state,
      deliveredReply: params.deliveredReply, mode: params.mode, verifiedId: replacementId, collectingField,
      purpose: turnIntent(params.message) === "order" || params.state?.processes?.active === "order" && turnIntent(params.message) !== "information" || replacementId ? "order" : "information" });
    if (reference.status === "clarify") {
      scope.entity = { status: "unresolved", kind: "product" };
      const state = await migrateState();
      if (replacementId) delete state.processes!.pendingChoice;
      return entityClarification(state, reference.reply);
    }
    if (reference.status === "selected") {
      scope.entity = { status: "resolved", kind: "product", id: reference.product.id };
      const ordering = turnIntent(params.message) === "order" || params.state?.processes?.active === "order" && turnIntent(params.message) !== "information" || Boolean(replacementId);
      params = { ...params, selectedProductId: ordering ? reference.product.id : undefined, orderRequest: ordering, informationRequest: !ordering };
    }
  }
  const statusRequested = isOrderStatusRequest(params.message) || isOrderStatusFollowUp(params.message, params.state);
  const statusTurn = async (state: ConversationStatePayload) => {
    const result = await customerOrderStatus({ businessId: params.businessId, message: params.message, state,
      identity: params.customerIdentity, isolated: params.mode === "test" || Boolean(params.visualPreview) || Boolean(params.linearPreview) });
    return { ...plainResult(result.nextState, result.reply), orderStatusPending: result.pending };
  };
  // The adapter is supplied here, never accepted from a customer-controlled chat payload.
  params = { ...params, orderStatusTurn: statusTurn };
  if (statusRequested) {
    const state = await migrateState();
    const profileBefore = JSON.stringify(state.context!.profile);
    explicitProfile(state, params.message, true);
    if (JSON.stringify(state.context!.profile) !== profileBefore && state.processes!.order) {
      invalidateOrderReview(state.processes!.order.snapshot.execution);
    }
    // The status answer replaces the last question. Preserve tasks, but do not let a
    // later bare yes accept an older replace/process choice the customer no longer sees.
    delete state.processes!.pendingChoice;
    const suspended = currentProcessOwner(state) ?? state.processes!.active ?? interruptedProcess(state) ?? undefined;
    suspendProcesses(state);
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
      reason: "Kontrollohet statusi i porosisë ekzistuese; proceset në vazhdim ruhen.", suspended, reusedFields: [], missingFields: result.orderStatusPending ? ["order_reference"] : [] };
    result.nextState = state; result.conversationRouting = decision;
    params.onTrace?.({ stage: "workflow", label: "Customer order status", data: decision });
    return result;
  }
  // An unrelated request ends the short-lived choice; a later number must not select an old list.
  if (params.state && readOrderStatusLookup(params.state, true)) {
    params = { ...params, state: structuredClone(params.state) };
    setOrderStatusLookup(params.state!);
  }
  if (params.linearPreview) {
    // Keep this preview scoped to its existing linear adapter, but use the same turn control.
    // It must never route into a live booking or a newly published visual workflow.
    if (params.state?.processes?.informationOnly) {
      const answer = await processLegacyAgentTurn({ ...params, state: structuredClone(params.state),
        informational: "Answer only the informational request. Do not start, resume or confirm a process." });
      const catalogContext = readCatalogContext(answer.nextState.fields.catalog_context);
      if (catalogContext) params.state.fields.catalog_context = catalogContext;
      answer.nextState = params.state;
      return answer;
    }
    const answer = await processAgentTurn({ ...params, ...(clarificationResume ? { message: "", orderRequest: true } : {}) });
    const processes = answer.nextState.processes;
    if (processes?.order) {
      const completed = answer.nextState.step_key === "order_ready";
      processes.order.snapshot = snapshotOrder(answer.nextState);
      processes.order.status = completed ? "completed" : "active";
      processes.active = completed ? null : "order"; processes.promptOwner = processes.active;
    }
    if (clarificationResume) answer.conversationRouting = { process: "order", action: "resume", source: "rules", reason: "clarification_resume", reusedFields: [], missingFields: [] };
    return answer;
  }
  if (!usesSharedCoordinator(params)) {
    // Keep non-pilot conversations on legacy until explicitly enrolled.
    if (isStaffContactRequest(params.message) && explicitIntent(params.message) !== "order") {
      const state = structuredClone(params.state ?? emptyState());
      const result = await processLegacyAgentTurn({ ...params, state, informational: staffContactInstructions });
      result.nextState = state; result.handoff = true; result.advisoryHandoff = true;
      return result;
    }
    if (explicitIntent(params.message) === "support") {
      const version = await loadVisualVersion(params.businessId, params.state?.visual?.versionId);
      if (!version) return { ...plainResult(structuredClone(params.state ?? emptyState()), staffHandoffReply(params.mode === "test")), handoff: true, advisoryHandoff: false };
      return processAgentTurn({ ...params, supportRequest: true });
    }
    const booking = await processBookingTurn(params);
    if (booking) {
      // Non-pilot legacy booking still owns its classifier during compatibility.
      // Record its executor explicitly rather than misreporting coordinator-only.
      dispatch({ ...params, bookingRequest: true }, "booking");
      return booking;
    }
    return processAgentTurn(params);
  }
  let state = await migrateState();
  const processes = state.processes!;
  const interrupted = interruptedProcess(state);
  const oldProfile = JSON.stringify(state.context!.profile);
  const graphVersion = clarificationResume === "order" && !state.visual ? null
    : params.visualPreview ?? await loadVisualVersion(params.businessId, clarificationResume === "service" || clarificationResume === "actionFlow" ? processes[clarificationResume]?.versionId : processes.active === "booking" || clarificationResume === "booking" ? processes.booking?.versionId : state.visual?.versionId);
  if (clarificationResume) params = { ...params, entityVersion: graphVersion };
  const entityMessage = processes.pendingChoice?.kind === "replace" && affirmative(params.message) ? processes.pendingChoice.message : params.message;
  const ordinaryQuestion = Boolean(params.informationRequest) || turnIntent(entityMessage) === "information" || Boolean(processes.informationOnly && !explicitContinuation(entityMessage) && !bookingRequest(foldText(entityMessage))) || turnIntent(entityMessage) !== "order" && (isEntityInformationRequest(entityMessage) || isQuestion(entityMessage) && !/\b(dua|kerkoj|rezervo|book|want|vazhdo|rifillo)\b/.test(foldText(entityMessage)));
  if (ordinaryQuestion && graphVersion && scope.entity?.status !== "resolved") {
    const information = await resolveVisualEntity(params.businessId, graphVersion.graph, entityMessage, undefined, params.mode === "test", { state, deliveredReply: params.deliveredReply });
    if (information.clarification || information.choices?.length) {
      scope.entity = { status: "unresolved", kind: "unknown" };
      return entityClarification(state, information.clarification ?? `Cilin produkt ose shërbim dëshiron: ${information.choices!.map(entity => entity.name).join(", ")}?`);
    }
    const entity = information.mentioned ?? information.selected?.entity;
    if (entity) scope.entity = { status: "resolved", kind: entity.kind, id: entity.id };
  }
  // Unbound custom action processes share the existing visual executor and keep
  // order/booking snapshots intact. A question cannot authorize a write.
  const savedAction = processes.actionFlow;
  const actionVersion = savedAction
    ? (params.visualPreview ??
      (await loadVisualVersion(params.businessId, savedAction.versionId)))
    : graphVersion;
  const actionFlows =
    actionVersion?.graph.version === 2
      ? actionVersion.graph.flows.filter(
          (f) =>
            f.kind === "custom" &&
            !f.productIds?.length &&
            !f.serviceIds?.length &&
            f.nodeIds.some((id) =>
              actionVersion.graph.nodes.some(
                (n) => n.id === id && n.kind === "action",
              ),
            ),
        )
      : [];
  let namedAction = clarificationResume === "actionFlow"
    ? actionFlows.find(f => f.nodeIds.includes(savedAction!.visual.nodeId))
    : !ordinaryQuestion ? actionFlows.find((f) =>
        foldText(params.message).includes(foldText(f.label)),
      )
    : undefined;
  const continuingAction = (currentProcessOwner(state) === "actionFlow" || interrupted === "actionFlow") && !namedAction && !ordinaryQuestion
    && !["order", "support"].includes(explicitIntent(params.message)) && !bookingRequest(foldText(params.message));
  if (
    !namedAction &&
    !continuingAction &&
    !ordinaryQuestion &&
    actionFlows.length &&
    !processes.active &&
    !["order", "support"].includes(explicitIntent(params.message)) &&
    !bookingRequest(foldText(params.message))
  ) {
    const selected = await chooseGuidance({
      message: params.message,
      state,
      targets: [],
      routes: actionFlows.map((f) => ({
        id: f.id,
        label: f.label,
        kind: "custom",
      })),
      allowOrder: false,
      allowSupport: false,
    });
    if (selected.action === "route")
      namedAction = actionFlows.find((f) => f.id === selected.target);
  }
  if (actionVersion && (continuingAction || namedAction)) {
    const resumeNamed = Boolean(savedAction && namedAction?.nodeIds.includes(savedAction.visual.nodeId));
    const prior = continuingAction || resumeNamed ? savedAction : undefined;
    suspendProcesses(state, "actionFlow");
    delete processes.auxiliary; delete processes.pendingChoice; delete processes.informationOnly; delete state.conversationPaused;
    const adapter = structuredClone(state);
    adapter.context = { profile: structuredClone(state.context!.profile), order: structuredClone(prior?.order ?? {}), execution: { factOwner: "auxiliary" } };
    adapter.fields = structuredClone(prior?.fields ?? {});
    adapter.visual = resumeNamed
      ? { ...structuredClone(savedAction!.visual), awaiting: false }
      : continuingAction
        ? structuredClone(savedAction!.visual)
        : {
            versionId: actionVersion.id,
            nodeId: namedAction!.entryNodeId,
            status: "running",
            awaiting: false,
            visited: [],
            values: {},
          };
    if (!continuingAction || !savedAction?.promptCurrent) { delete adapter.visual.pendingConfirmation; delete adapter.visual.confirmedConfirmation; }
    scope.routing = { process: "information", action: resumeNamed ? "resume" : continuingAction ? "continue" : "start", source: "rules", reason: "action_flow", reusedFields: [], missingFields: [], ...(resumeNamed ? { resumed: "actionFlow" } : {}) };
    scope.process = "actionFlow";
    const answer = await processAgentTurn({
      ...params,
      message: resumeNamed ? "" : params.message,
      state: adapter,
      entityVersion: actionVersion,
      actionFlowRequest: true,
    });
    const cursor = answer.nextState.visual;
    if (cursor?.status === "waiting")
      processes.actionFlow = {
        id: prior?.id ?? randomUUID(),
        versionId: actionVersion.id,
        visual: cursor,
        promptCurrent: Boolean(cursor.awaiting),
        order: answer.nextState.context?.order,
        fields: answer.nextState.fields,
      };
    else delete processes.actionFlow;
    state.context!.profile = answer.nextState.context?.profile ?? state.context!.profile;
    state.customer = answer.nextState.customer;
    if (JSON.stringify(state.context!.profile) !== oldProfile && processes.order) invalidateOrderReview(processes.order.snapshot.execution);
    answer.nextState = state;
    processes.promptOwner = null;
    answer.conversationRouting = { process: "information", action: resumeNamed ? "resume" : continuingAction ? "continue" : "start", source: "rules",
      reason: clarificationResume ? "clarification_resume" : "action_flow", ...(resumeNamed ? { resumed: "actionFlow" } : {}), reusedFields: [], missingFields: [] };
    return answer;
  }
  const continueService = clarificationResume === "service" || (processes.service?.status === "active" || interrupted === "service") && !ordinaryQuestion && !["order", "support"].includes(explicitIntent(params.message)) && !bookingRequest(foldText(params.message));
  let serviceVersion = continueService ? params.visualPreview ?? await loadVisualVersion(params.businessId, processes.service!.versionId) : graphVersion;
  const referenceContext = { state, selectedProductId: params.selectedProductId, selectedServiceId: params.selectedServiceId, deliveredReply: params.deliveredReply, draftPreview: Boolean(params.visualPreview) };
  let entityResolution = !ordinaryQuestion && serviceVersion ? await resolveVisualEntity(params.businessId, serviceVersion.graph, entityMessage, continueService ? processes.service?.visual.binding : undefined, params.mode === "test", referenceContext) : {};
  let resumingService = Boolean(continueService && entityResolution.selected?.entity.id === processes.service?.visual.binding?.entity.id);
  if (!ordinaryQuestion && !continueService && processes.service && processes.service.status !== "completed") {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, processes.service.versionId);
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, undefined, params.mode === "test", referenceContext) : {};
    if (match.selected && match.selected.entity.id === processes.service.visual.binding?.entity.id && match.selected.entity.kind === processes.service.visual.binding.entity.kind) { entityResolution = match; serviceVersion = pinned; resumingService = true; }
  }
  let resumingOrder = false;
  const orderVisual = processes.order?.status !== "completed" ? processes.order?.snapshot.visual : undefined;
  if (!ordinaryQuestion && orderVisual?.binding && !processes.pendingChoice) {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, orderVisual.versionId);
    const continuing = (processes.active === "order" || interrupted === "order") && explicitIntent(entityMessage) !== "support" && !bookingRequest(foldText(entityMessage));
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, resumeOrder(foldText(entityMessage)) || continuing ? orderVisual.binding : undefined, params.mode === "test", referenceContext) : {};
    if (match.selected?.entity.kind === "product" && match.selected.entity.id === orderVisual.binding.entity.id) { entityResolution = match; serviceVersion = pinned; resumingOrder = true; resumingService = false; }
  }
  let resumingBooking = false;
  const bookingVisual = processes.booking?.status !== "completed" ? processes.booking?.visual : undefined;
  if (!ordinaryQuestion && bookingVisual?.binding && !processes.pendingChoice) {
    const pinned = params.visualPreview ?? await loadVisualVersion(params.businessId, bookingVisual.versionId);
    const continuing = processes.active === "booking" && !["order", "support"].includes(explicitIntent(entityMessage)) && !resumeOrder(foldText(entityMessage));
    const match = pinned ? await resolveVisualEntity(params.businessId, pinned.graph, entityMessage, continuing ? bookingVisual.binding : undefined, params.mode === "test", referenceContext) : {};
    if (match.selected?.entity.kind === "service" && match.selected.entity.id === bookingVisual.binding.entity.id) { entityResolution = match; serviceVersion = pinned; resumingBooking = true; resumingService = false; resumingOrder = false; }
  }
  const freshEntityVersion = !clarificationResume && !ordinaryQuestion && !resumingService && !resumingOrder && !resumingBooking && Boolean(state.visual);
  if (freshEntityVersion && !params.visualPreview) {
    const latest = await loadVisualVersion(params.businessId);
    entityResolution = latest ? await resolveVisualEntity(params.businessId, latest.graph, entityMessage, undefined, params.mode === "test", referenceContext) : {};
    serviceVersion = latest;
  }
  const selectedEntity = entityResolution.selected;
  if (selectedEntity) scope.entity = { status: "resolved", kind: selectedEntity.entity.kind, id: selectedEntity.entity.id };
  if (entityResolution.clarification || entityResolution.choices?.length) scope.entity = { status: "unresolved", kind: "unknown" };
  if (entityResolution.clarification) return entityClarification(state, entityResolution.clarification);
  if (entityResolution.choices?.length) {
    return { ...entityClarification(state, `Cilin produkt ose shërbim dëshiron: ${entityResolution.choices.map(entity => entity.name).join(", ")}?`),
      presentedProducts: entityResolution.choices.every(entity => entity.kind === "product") ? entityResolution.choices : undefined,
      presentedServices: entityResolution.choices.every(entity => entity.kind === "service") ? entityResolution.choices : undefined };
  }
  if (params.visualPreview && !selectedEntity && entityResolution.mentioned?.kind === "product"
    && serviceVersion?.graph.version === 2 && !serviceVersion.graph.flows.some(flow => flow.kind === "order" && !flow.productIds?.length && !flow.serviceIds?.length)) {
    // Preview setup failure is not an order intent. Do not force an informational
    // selection through an executable adapter merely to obtain its diagnostic.
    const result = plainResult(state, "Produkti nuk ka lidhje me këtë draft. Konfiguro lidhjen në rrjedhë dhe rifillo provën; nuk u ekzekutua një workflow tjetër.");
    result.debug.fallbackReason = "preview_binding_missing";
    scope.decision = { ...decisionForTurn({ message: params.message, state, executor: "coordinator" }), kind: "blocked", reason: "capability" };
    return result;
  }
  const entityFlow = selectedEntity && serviceVersion?.graph.version === 2 ? serviceVersion.graph.flows.find(flow => flow.id === selectedEntity.binding.flowId) : undefined;
  const serviceBooking = selectedEntity?.entity.kind === "service" && entityFlow?.nodeIds.some(id => serviceVersion!.graph.nodes.some(node => node.id === id && node.kind === "booking"));
  const productOrder = selectedEntity?.entity.kind === "product" && Boolean(entityFlow && (entityFlow.kind === "order" || entityFlow.nodeIds.some(id => serviceVersion!.graph.nodes.some(node => node.id === id && node.kind === "product")) || entityFlow.kind === "custom" && (explicitIntent(entityMessage) === "order" || processes.order?.snapshot.product_id === selectedEntity.entity.id && orderVisual?.binding?.entity.id === selectedEntity.entity.id)));
  const entityOnly = Boolean((productOrder || serviceBooking) && turnIntent(entityMessage) === "undetermined"
    && !params.selectedProductId && !resumingOrder && !resumingBooking && !clarificationResume && !explicitContinuation(entityMessage));
  if (selectedEntity && entityFlow && !productOrder && !serviceBooking && serviceVersion && !processes.pendingChoice) {
    if (affirmative(params.message) && processes.service && !processes.service.promptCurrent) return entityClarification(state, "Cilën kërkesë dëshiron të konfirmosh? Shkruaj shërbimin që dëshiron të vazhdosh.");
    const old = processes.service?.status !== "completed" && processes.service?.visual.binding?.entity.id === selectedEntity.entity.id && processes.service.visual.binding.entity.kind === selectedEntity.entity.kind ? processes.service : undefined;
    const resume = old?.status === "suspended" && (interrupted !== "service" || foldText(params.message).includes(foldText(selectedEntity.entity.name)));
    suspendProcesses(state, "service");
    delete processes.auxiliary; delete processes.informationOnly; delete state.conversationPaused;
    const adapter = migrateContext(emptyState()); adapter.schemaVersion = 3; adapter.processes = processes;
    adapter.context!.execution.factOwner = "service";
    adapter.context!.profile = structuredClone(state.context!.profile); adapter.customer = structuredClone(state.customer); adapter.recentMessages = state.recentMessages;
    adapter.fields = structuredClone(old?.fields ?? {}); adapter.context!.order = structuredClone(old?.order ?? {});
    adapter.visual = structuredClone(old?.visual) ?? { versionId: serviceVersion.id, nodeId: entityFlow.entryNodeId, status: "running", awaiting: false, visited: [], values: {}, binding: selectedEntity.binding };
    if (old?.status === "suspended") { if (resume) adapter.visual.awaiting = false; delete adapter.visual.pendingConfirmation; delete adapter.visual.confirmedConfirmation; }
    scope.routing = { process: "information", action: resume ? "resume" : old ? "continue" : "start", source: "rules", reason: "service_flow", reusedFields: [], missingFields: [], ...(resume ? { resumed: "service" } : {}) };
    scope.process = "service";
    const answer = await processAgentTurn({ ...params, message: resume ? "" : params.message, state: adapter, entityVersion: serviceVersion });
    const visual = answer.nextState.visual!;
    processes.service = { id: old?.id ?? randomUUID(), versionId: serviceVersion.id, visual, status: visual.status === "waiting" ? "active" : "completed", promptCurrent: visual.status === "waiting", fields: answer.nextState.fields, order: answer.nextState.context?.order ?? {} };
    state.context!.profile = answer.nextState.context?.profile ?? state.context!.profile; state.customer = answer.nextState.customer;
    if (JSON.stringify(state.context!.profile) !== oldProfile && processes.order) invalidateOrderReview(processes.order.snapshot.execution);
    state.visual = visual;
    processes.active = null; processes.promptOwner = null; delete processes.pendingChoice;
    const decision: ConversationRouting = { process: "information", action: resume ? "resume" : old ? "continue" : "start", source: "rules", reason: clarificationResume ? "clarification_resume" : `Vazhdon rrjedha e lidhur me ${selectedEntity.entity.name}.`, ...(resume ? { resumed: "service" as const } : {}), reusedFields: Object.keys(state.context!.profile), missingFields: [] };
    answer.nextState = state; answer.workflowId = null; answer.conversationRouting = decision;
    return answer;
  }
  if (selectedEntity || freshEntityVersion || (!orderVisual && explicitIntent(entityMessage) === "order" && serviceVersion)) params = { ...params, entityVersion: serviceVersion };
  if (!clarificationResume) explicitProfile(state, params.message, processes.informationOnly);
  const steps = state.context?.execution.linear?.steps ?? [];
  if (!clarificationResume && !params.selectedProductId) await extractMessageFacts(state, params.message, [...profileExtractionFields,
    ...(ordinaryQuestion || processes.active !== "order" ? [] : steps.filter(step => !["confirm", "customer", "photo"].includes(step.kind)).map(step => ({ key: step.fieldKey ?? step.key, type: step.fieldType ?? "text" as const, label: step.label, options: step.options }))),
    ...(ordinaryQuestion || processes.active !== "order" || !graphVersion ? [] : ownedCollectNodes(graphVersion.graph, state.visual).filter(node => node.config.fieldKey).map(node => ({ key: node.config.fieldKey!, type: node.config.fieldType ?? "text" as const, label: node.label })))]);
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
    invalidateOrderReview(processes.order.snapshot.execution);
  }
  let message = params.message;
  let replacementResolved = false;
  let replacementDeclined = false;
  let route = params.informationRequest ? { process: "information" as const, source: "rules" as const }
    : params.selectedProductId ? { process: "order" as const, source: "rules" as const } : await routeMessage(message, state);
  if (entityOnly) route = { process: "information", source: "rules" };
  else if (serviceBooking) route = { process: "booking", source: "rules" };
  else if (productOrder) route = { process: "order", source: "rules" };
  const decision: ConversationRouting = { ...route, action: "continue", reason: "Mesazhi vazhdon procesin aktual.", reusedFields: [], missingFields: [] };
  scope.routing = decision;
  const finish = (result: AgentTurnResult) => {
    result.nextState.schemaVersion = 3;
    result.nextState.processes = processes;
    result.conversationRouting = decision;
    if (clarificationResume && decision.action === "resume") decision.reason = "clarification_resume";
    return result;
  };
  const clarify = (reply: string) => {
    decision.process = "clarify"; decision.action = "clarify"; decision.reason = reply;
    processes.promptOwner = null;
    if (processes.actionFlow) processes.actionFlow.promptCurrent = false;
    if (processes.service) processes.service.promptCurrent = false;
    return finish(plainResult(state, reply));
  };
  // Answer interruptions without forcing a choice. Replacement approval expires;
  // a mixed request retains its details until the customer names a process.
  const choiceInterrupted = route.process === "information" || route.process === "support";
  if (choiceInterrupted && (processes.pendingChoice?.kind === "replace" || route.process === "support")) delete processes.pendingChoice;
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
  } else if (processes.pendingChoice?.kind === "process" && !choiceInterrupted) {
    if (route.process !== "order" && route.process !== "booking") return clarify("Cilën të trajtojmë fillimisht: porosinë apo rezervimin?");
    message = `${processes.pendingChoice.message}\nTani vazhdo vetëm ${route.process === "order" ? "porosinë" : "rezervimin"}.`;
    delete processes.pendingChoice;
  }
  decision.process = route.process; decision.source = route.source;
  if (route.process === "clarify") {
    if (route.clarification) return clarify(route.clarification);
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
    // Auxiliary input belongs to the information flow until it finishes, but its
    // original suspended owner must survive every turn for the later continuation.
    const previousOwner = currentProcessOwner(state) ?? processes.active ?? interrupted
      ?? (processes.auxiliary?.process === "information" ? processes.lastDecision?.suspended : undefined);
    decision.suspended = previousOwner ?? undefined;
    suspendProcesses(state);
    decision.action = "answer"; decision.reason = "Pyetja merr përgjigje; progresi i porosisë dhe rezervimit ruhet.";
    processes.promptOwner = null;
    const version = freshEntityVersion ? serviceVersion : graphVersion;
    const entry = version?.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "information")?.entryNodeId : undefined;
    const knowledge = version?.graph.nodes.find(node => node.id === entry && node.kind === "knowledge") ?? version?.graph.nodes.find(node => node.kind === "knowledge");
    const configuredInformation = version?.graph.version === 2 && version.graph.flows.some(flow => flow.kind === "information");
    if (configuredInformation) {
      const adapter = structuredClone(state);
      adapter.context = { profile: structuredClone(state.context!.profile), order: structuredClone(processes.auxiliary?.order ?? {}), execution: { factOwner: "auxiliary" } };
      adapter.fields = structuredClone(processes.auxiliary?.fields ?? {});
      if (state.fields.catalog_context) adapter.fields.catalog_context = structuredClone(state.fields.catalog_context);
      adapter.visual = processes.auxiliary?.process === "information" ? processes.auxiliary.visual : undefined;
      // An informational subflow may collect its own details. Keep the order's pinned
      // cursor separately; only the shared facts cross back into that task.
      const answer = await processAgentTurn({ ...params, state: adapter, informationRequest: true });
      const catalogContext = readCatalogContext(answer.nextState.fields.catalog_context);
      if (catalogContext) state.fields.catalog_context = catalogContext;
      if (answer.nextState.visual?.status === "waiting") processes.auxiliary = { process: "information", visual: answer.nextState.visual, order: answer.nextState.context?.order, fields: answer.nextState.fields };
      else {
        delete processes.auxiliary;
        answer.nextState.visual = previousOwner === "order" ? processes.order?.snapshot.visual : previousOwner === "booking" ? processes.booking?.visual : state.visual;
      }
      // An informational adapter owns only its auxiliary cursor, not order facts or approvals.
      // Explicit facts from this message were already validated above, before the adapter.
      answer.nextState = { ...state, visual: answer.nextState.visual };
      return finish(answer);
    }
    const answer = await processLegacyAgentTurn({ ...params, state: structuredClone(state), informational: `Respond to the current message in the context of the recent conversation, including answers to a question you asked the customer. Use verified business information and the configured agent's tone. Respond naturally to greetings, including obvious typos. If the message is unclear, briefly ask what the customer needs; do not assume there is a request to change or resume an order or booking. Continue the relevant conversation without starting an order or asking which product they want unless they request ordering. Preserve every unfinished task. Do not confirm or perform an action and do not repeat the previous workflow question.${knowledge?.config.prompt ? ` Configured informational workflow guidance: ${knowledge.config.prompt}` : ""}` });
    // Qualification is auxiliary information, not permission to merge adapter
    // order facts, approvals or cursors back into the suspended process.
    const catalogContext = readCatalogContext(answer.nextState.fields.catalog_context);
    if (catalogContext) state.fields.catalog_context = catalogContext;
    answer.nextState = state;
    return finish(answer);
  }
  if (route.process === "support") {
    decision.action = "answer"; decision.reason = "Klienti kërkon ndihmë; proceset e papërfunduara mbeten të ruajtura.";
    decision.suspended = currentProcessOwner(state) ?? processes.active ?? undefined;
    suspendProcesses(state);
    if (contactFollowUp(message, state) || isStaffContactRequest(message)) {
      const result = await processLegacyAgentTurn({ ...params, state, informational: staffContactInstructions });
      result.nextState = state; result.handoff = true; result.advisoryHandoff = true;
      return finish(result);
    }
    const supportAdapter = structuredClone(state);
    supportAdapter.context = { profile: structuredClone(state.context!.profile), order: structuredClone(processes.auxiliary?.process === "support" ? processes.auxiliary.order ?? {} : {}), execution: { factOwner: "auxiliary" } };
    supportAdapter.fields = structuredClone(processes.auxiliary?.process === "support" ? processes.auxiliary.fields ?? {} : {});
    const result = graphVersion
      ? await processAgentTurn({ ...params, state: supportAdapter, supportRequest: true })
      : { ...plainResult(state, staffHandoffReply(params.mode === "test")), handoff: true, advisoryHandoff: false };
    if (!graphVersion) { result.nextState = state; result.handoff = true; }
    if (result.nextState.visual?.status === "waiting") processes.auxiliary = { process: "support", visual: result.nextState.visual, order: result.nextState.context?.order, fields: result.nextState.fields };
    else delete processes.auxiliary;
    result.nextState = { ...state, visual: result.nextState.visual };
    // Routing to staff must not replace the saved order task with the handoff cursor.
    // Preserve the executor's ownership decision; only contact advice is advisory.
    return finish(result);
  }
  const target = route.process;
  if (processes.informationOnly) { delete processes.informationOnly; delete state.conversationPaused; }
  delete processes.auxiliary;
  if (target === "booking" && processes.booking?.status === "completed") delete processes.booking;
  const task = processes[target];
  const changedBookedService = target === "booking" && serviceBooking && selectedEntity && processes.booking?.draft?.serviceId && processes.booking.draft.serviceId !== selectedEntity.entity.id;
  if (task && task.status !== "completed" && (newRequest(foldText(message), target) || changedBookedService) && !replacementResolved) {
    processes.pendingChoice = { kind: "replace", process: target, message, ...(changedBookedService ? { serviceId: selectedEntity!.entity.id } : {}) };
    return clarify(`Ke një ${target === "order" ? "porosi" : "rezervim"} të papërfunduar. Ta zëvendësojmë me kërkesën e re? Shkruaj “Po” ose “Jo”.`);
  }
  const previousActive = processes.active;
  const previousOwner = currentProcessOwner(state) ?? previousActive ?? processes.lastDecision?.suspended;
  suspendProcesses(state, target);
  if (previousOwner && previousOwner !== target) decision.suspended = previousOwner;
  decision.action = task?.status === "suspended" || (task && previousActive !== target) ? "resume" : task?.status === "active" ? "continue" : "start";
  if (task && interrupted === target && !explicitContinuation(message) && !confirmation && !params.selectedProductId) decision.action = "continue";
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
    dispatch({ ...params, bookingRequest: true }, "booking");
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
      versionId: processes.booking?.versionId ?? bookingVersion?.id, visual: result.nextState.visual,
      order: result.nextState.context?.order, fields: result.nextState.fields };
    processes.active = waiting ? "booking" : null; processes.promptOwner = waiting ? "booking" : null;
    result.nextState.processes = processes;
    decision.missingFields = draft ? ["serviceId", "date", "time", "name"].filter(key => !draft[key as keyof BookingDraft]).map(key => `booking.${key}`) : [];
    if (informationalQuestion(foldText(message))) {
      const answer = await processLegacyAgentTurn({ ...params, state: result.nextState, informational: "Answer only the informational question using verified business information; no actions or confirmation. The separate booking response will follow." });
      const reply = `${answer.reply}\n\n${result.reply}`;
      result.presentedProducts = combineProductPresentations(reply, [answer, result]);
      result.presentedServices = combineProductPresentations(reply, [answer, result].map(part => ({ reply: part.reply, presentedProducts: part.presentedServices })));
      result.reply = reply;
    }
    return finish(result);
  }
  if (processes.order?.status === "completed") { delete processes.order; state = resetOrder(state); }
  else if (processes.order) {
    state = restoreOrder(state, { resume: decision.action === "resume" && !confirmation });
    // Entity discovery may use the latest publication, but this is still the saved
    // order. Let the executor load its cursor's pin (or the authenticated preview).
    if (state.visual && params.entityVersion?.id !== state.visual.versionId) params = { ...params, entityVersion: undefined };
  }
  else if (freshEntityVersion && state.visual?.binding && (!selectedEntity || selectedEntity.binding.flowId !== state.visual.binding.flowId || params.entityVersion?.id !== state.visual.versionId)) delete state.visual;
  let usedBookingNode = false;
  if (replacementDeclined) params = { ...params, entityVersion: undefined };
  // Resume is navigation, not a value for the pending field (including product_query).
  const result = await processAgentTurn({ ...params, message: clarificationResume === "order" ? "" : message, state, orderRequest: Boolean(params.selectedProductId) || decision.action === "resume" && !confirmation || resumeOrder(foldText(message)) || turnIntent(message) === "order",
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
      versionId: result.nextState.visual?.versionId, visual: result.nextState.visual,
      order: result.nextState.context?.order, fields: result.nextState.fields };
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
    const reply = `${answer.reply}\n\n${result.reply}`;
    result.presentedProducts = combineProductPresentations(reply, [answer, result]);
    result.presentedServices = combineProductPresentations(reply, [answer, result].map(part => ({ reply: part.reply, presentedProducts: part.presentedServices })));
    result.reply = reply;
  }
  const completed = result.nextState.step_key === "order_ready";
  processes.order = { id: processes.order?.id ?? randomUUID(), status: completed ? "completed" : "active", snapshot: snapshotOrder(result.nextState) };
  processes.active = completed ? null : "order"; processes.promptOwner = completed ? null : "order";
  decision.missingFields = result.workflowProgress.filter(step => step.status !== "done").map(step => step.key);
  return finish(result);
}
