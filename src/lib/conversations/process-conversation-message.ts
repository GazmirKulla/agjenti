import { randomUUID } from "node:crypto";
import { processBookingTurn, type BookingDraft } from "@/lib/calendar/agent";
import type { BookingEffectGuard } from "@/lib/calendar/service";
import { agentModel } from "@/lib/agents/generate";
import { processAgentTurn, processLegacyAgentTurn, type AgentTurnParams, type AgentTurnResult } from "./process-agent-turn";
import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { affirmative, extractExplicitFacts, isQuestion, resetOrder, setFact, sharedWorkflowEnabled } from "@/lib/workflows/context";
import { extractMessageFacts, profileExtractionFields } from "@/lib/workflows/extract-facts";
import { chooseGuidance, explicitIntent, rememberTurn } from "@/lib/workflows/guidance";
import { bookingAdapterState, migrateConversationProcesses, restoreOrder, snapshotOrder, type ConversationRouting, type ProcessKind } from "@/lib/workflows/conversation-processes";
import { loadVisualVersion } from "@/lib/workflows/visual/store";

export type ConversationMessageParams = AgentTurnParams & {
  conversationKey?: string;
  bookingGuard?: BookingEffectGuard;
  /** Production adapter rechecks manual ownership immediately before booking effects. */
  canAct?: () => Promise<boolean>;
};
type Route = Pick<ConversationRouting, "process" | "source">;
const namedConfirmation = (message: string): ProcessKind | null => { const match = foldText(message).match(/^(?:po )?(?:e )?konfirmoj (porosine|rezervimin)[.!\s]*$/); return match ? match[1] === "porosine" ? "order" : "booking" : null; };
const bookingRequest = (text: string) => /\b(rezerv\w*|takim\w*|appointment|booking|termin|orar\w* (?:te )?lir\w*)\b/.test(text);
const informationalQuestion = (text: string) => /\b(sa kushton|cmimi|price|ku ndodhe|ku jeni|kur hap|orar(?:i)? (?:i punes|punes)|si pagu|pagesa|sa zgjat|what.*cost|how much)\b/.test(text);
const resumeOrder = (text: string) => /\b(vazhdo\w*|ktheh\w*|rifill\w*|resume)\b.*\b(porosi\w*|order)\b/.test(text);
const newRequest = (text: string, kind: ProcessKind) => kind === "order" ? /\b(porosi (?:te |nje )?re|porosi tjeter|new order|another order)\b/.test(text) : /\b(rezervim (?:te |nje )?ri|rezervim tjeter|takim tjeter|new booking|another booking)\b/.test(text);

async function routeMessage(message: string, state: ConversationStatePayload): Promise<Route> {
  const text = foldText(message), intent = explicitIntent(message);
  const confirmation = namedConfirmation(message);
  if (confirmation) return { process: confirmation, source: "rules" };
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
function explicitProfile(state: ConversationStatePayload, message: string) {
  extractExplicitFacts(state, message, state.context?.execution.linear?.steps ?? []);
  // Contact labels anchor the number to this customer's own statement, including mixed question/fact turns.
  const phone = message.match(/(?:telefoni?\s*(?:im)?|numri\s+im|my\s+(?:phone|number))\s*(?:(?:është|eshte|is)\s*|[:=]\s*)(\+?[\d ().-]{7,24}\d)/i);
  if (phone) setFact(state, "customer_phone", phone[1].trim(), "phone", "message_phone");
}

/** One message coordinator for Instagram, isolated chat and graph previews. Adapters own persistence/send. */
export async function processConversationMessage(params: ConversationMessageParams): Promise<AgentTurnResult> {
  if (params.canAct && !(await params.canAct())) throw new Error("conversation_manually_paused");
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
  let route = await routeMessage(message, state);
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
    decision.action = "answer"; decision.reason = "Klienti kërkon ndihmë; proceset e papërfunduara mbeten të ruajtura.";
    if (processes.active) {
      const task = processes[processes.active]; if (task) task.status = "suspended";
      decision.suspended = processes.active;
    }
    processes.active = null; processes.promptOwner = null;
    const result = await processAgentTurn({ ...params, state });
    if (result.nextState.visual?.status === "waiting") processes.auxiliary = { process: "support", visual: result.nextState.visual };
    else delete processes.auxiliary;
    // Routing to staff must not replace the saved order task with the handoff cursor.
    result.advisoryHandoff = result.handoff ? true : result.advisoryHandoff;
    return finish(result);
  }
  const target = route.process;
  delete processes.auxiliary;
  const task = processes[target];
  if (task && task.status !== "completed" && newRequest(foldText(message), target) && !replacementResolved) {
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
    const bookingVersion = processes.booking?.versionId && graphVersion?.id !== processes.booking.versionId ? await loadVisualVersion(params.businessId, processes.booking.versionId) : graphVersion;
    const bookingTurn = (bookingState: ConversationStatePayload) => processBookingTurn({ businessId: params.businessId, message, state: bookingState, mode: params.mode,
      conversationKey: params.conversationKey, onTrace: params.onTrace, routed: true, resume: decision.action === "resume",
      bookingGuard: params.bookingGuard, canAct: params.canAct });
    const configuredBooking = bookingVersion?.graph.version !== 2 || bookingVersion.graph.flows.some(flow => flow.kind === "booking");
    const result = !configuredBooking ? null : bookingVersion?.graph.nodes.some(node => node.kind === "booking")
      ? await processAgentTurn({ ...params, message, state: adapter, bookingRequest: true, bookingNavigation: decision.action === "resume" || bookingRequest(foldText(message)), bookingTurn })
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
  let usedBookingNode = false;
  const result = await processAgentTurn({ ...params, message, state, orderRequest: decision.action === "resume" || resumeOrder(foldText(message)) || explicitIntent(message) === "order",
    bookingTurn: async bookingState => {
      const adapter = bookingAdapterState(bookingState);
      const booking = await processBookingTurn({ businessId: params.businessId, message, state: adapter, mode: params.mode,
        conversationKey: params.conversationKey, onTrace: params.onTrace, routed: true, bookingGuard: params.bookingGuard, canAct: params.canAct });
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
