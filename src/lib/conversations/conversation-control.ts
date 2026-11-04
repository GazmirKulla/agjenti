import { messageUnderstanding } from "./understanding/context";
import { agentModel } from "@/lib/agents/generate";
import { affirmative, isQuestion } from "@/lib/workflows/context";
import { emptyState, type ConversationStatePayload } from "@/lib/workflows/state";
import { currentProcessOwner, suspendProcesses, type PendingClarification, type LocalProcessKind } from "@/lib/workflows/conversation-processes";
import { rememberTurn } from "@/lib/workflows/guidance";
import type { AgentTurnParams, AgentTurnResult } from "./process-agent-turn";
import { turnIntent } from "./turn-decision";
export const resumeClarificationPrompt = "Dëshiron të vazhdojmë kërkesën e mëparshme, apo po kërkon vetëm informacion?";
export function clarificationChoice(message: string): "information" | "resume" | "cancel" | null {
    const navigation = messageUnderstanding(message).navigation;
    return navigation === "information_only" ? "information" : navigation === "resume" ? "resume" : navigation === "cancel" ? "cancel" : null;
}
/** Bind navigation to a task identity and cursor, not mutable labels or AI prose. */
export function clarificationTarget(state: ConversationStatePayload, process: LocalProcessKind): PendingClarification["target"] {
    const task = state.processes?.[process];
    if (!task || ("status" in task && !["active", "suspended"].includes(task.status))) return null;
    if (process === "service" || process === "actionFlow") {
        const saved = state.processes![process]!;
        if (saved.visual.status === "completed" || saved.visual.status === "handoff") return null;
        return { process, id: saved.id ?? saved.versionId, versionId: saved.versionId,
            cursor: JSON.stringify([saved.visual.nodeId, saved.visual.binding?.flowId ?? null, saved.visual.binding?.entity.id ?? null]) };
    }
    if (process === "order") {
        const snapshot = state.processes!.order!.snapshot;
        if (snapshot.step_key === "order_ready" || snapshot.visual?.status === "completed") return null;
        return { process, id: state.processes!.order!.id, versionId: snapshot.visual?.versionId ?? snapshot.execution.linear?.versionId ?? snapshot.linearSnapshot?.versionId ?? null,
            cursor: JSON.stringify([snapshot.visual?.nodeId ?? null, snapshot.step_key ?? null, snapshot.product_id ?? null]) };
    }
    const booking = state.processes!.booking!;
    if ((!booking.draft && !booking.visual) || booking.visual?.status === "completed") return null;
    return { process, id: booking.id, versionId: booking.versionId ?? booking.visual?.versionId ?? null,
        cursor: JSON.stringify([booking.visual?.nodeId ?? null, booking.draft?.nonce ?? null, booking.draft?.phase ?? null]) };
}
export function offerResumeClarification(state: ConversationStatePayload) {
    const processes = state.processes;
    if (!processes || processes.pendingClarification) return;
    const candidates = (["order", "booking", "service", "actionFlow"] as const).map(process => clarificationTarget(state, process)).filter(target => target !== null);
    const owner = currentProcessOwner(state) ?? processes.active ?? processes.lastDecision?.suspended;
    const target = candidates.find(target => target.process === owner) ?? (candidates.length === 1 ? candidates[0] : null);
    if (!candidates.length) return;
    processes.pendingClarification = { kind: "resume_process", target, expiresAt: Date.now() + 15 * 60 * 1000 };
}
export function shortReply(message: string): boolean {
    return ["accept", "decline", "acknowledge", "uncertain"].includes(messageUnderstanding(message).act);
}
export function explicitContinuation(message: string): boolean {
    const m = messageUnderstanding(message);
    return m.navigation === "resume" || ["order", "booking", "service"].includes(m.intent);
}
function deferral(message: string): boolean { return messageUnderstanding(message).navigation === "defer"; }
function currentProposal(params: AgentTurnParams): boolean {
    const state = params.state;
    const reply = state?.recentMessages?.at(-1);
    if (reply?.role !== "assistant" || state?.conversationPaused)
        return false;
    // State is committed before delivery. Production must independently prove that
    // this exact last prompt, rather than an older question, was actually sent.
    if (params.mode !== "test" && params.deliveredReply?.slice(0, 1200) !== reply.content)
        return false;
    const owner = state && currentProcessOwner(state);
    if (state?.processes && !owner && !state.processes.pendingChoice && !state.processes.auxiliary)
        return false;
    const cursor = owner === "order" ? state?.processes?.order?.snapshot.visual
        : owner ? state?.processes?.[owner]?.visual : undefined;
    // Routing permission only. The runtime still validates expiry and the reviewed facts.
    if (cursor?.pendingConfirmation && cursor.pendingConfirmation.nodeId === cursor.nodeId) return true;
    const configured = state?.context?.execution.linear?.steps.find(step => step.key === state.step_key);
    return Boolean(state?.processes?.pendingChoice || state?.context?.execution.orderReview
        || configured && ["confirm", "choice"].includes(configured.kind));
}
/** A deterministic boundary before routing, extraction and side effects. */
export function conversationControl(params: AgentTurnParams): AgentTurnResult | null {
    const pause = deferral(params.message);
    const short = shortReply(params.message) && !params.hasPhoto && !params.hasAttachments;
    if (params.state?.processes?.informationOnly && !pause && !short) return null;
    if (!pause && !short && !(params.state?.conversationPaused && !params.informationRequest && turnIntent(params.message) !== "information" && !isQuestion(params.message) && !explicitContinuation(params.message)))
        return null;
    const meaning = messageUnderstanding(params.message);
    // Explicitly named confirmation is routed to its own receipt/freshness checks.
    if (!pause && meaning.act === "accept" && (meaning.process === "order" || meaning.process === "booking")) return null;
    if (!pause && short && currentProposal(params) && (affirmative(params.message) || messageUnderstanding(params.message).act === "decline"))
        return null;
    const state = structuredClone(params.state ?? emptyState());
    const suspended = currentProcessOwner(state) ?? state.processes?.active ?? state.processes?.lastDecision?.suspended;
    const unclear = !pause && Boolean(state.processes?.pendingClarification?.target || state.conversationPaused && !short && state.processes && (["order", "booking", "service", "actionFlow"] as const).some(kind => clarificationTarget(state, kind)));
    const hasTask = Boolean(state.processes && (["order", "booking", "service", "actionFlow"] as const).some(kind => clarificationTarget(state, kind)))
      || Boolean(!state.processes && state.product_id && state.step_key && state.step_key !== "order_ready");
    if (pause || hasTask) state.conversationPaused = true;
    else delete state.conversationPaused;
    if (state.processes) {
        delete state.processes.pendingChoice;
    }
    if (unclear) offerResumeClarification(state);
    else if (state.processes) delete state.processes.pendingClarification;
    suspendProcesses(state);
    const reply = pause ? "Në rregull, e lëmë këtu për momentin."
        : unclear ? resumeClarificationPrompt
            : "Në rregull 😊";
    const reason = pause ? "customer_deferred" : unclear ? "resume_requires_intent" : "acknowledgement_without_current_proposal";
    const decision = { process: "information" as const, action: unclear ? "clarify" as const : "answer" as const, source: "rules" as const, reason, reusedFields: [], missingFields: [], ...(suspended ? { suspended } : {}) };
    if (state.processes)
        state.processes.lastDecision = decision;
    rememberTurn(params.state, state, params.message, reply);
    params.onTrace?.({ stage: "workflow", label: "Conversation intent guard", data: { reason, advanced: false } });
    return { reply, nextState: state, previousResponseId: null, workflowId: params.persistedWorkflowId ?? state.context?.execution.linear?.id ?? null, productName: null, workflowProgress: [], conversationRouting: decision,
        debug: { model: agentModel(), source: "fallback", fallbackReason: reason, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 } };
}
export function resumeConversation(params: AgentTurnParams): AgentTurnParams {
    if (!params.state?.conversationPaused || !explicitContinuation(params.message) || deferral(params.message))
        return params;
    const state = structuredClone(params.state);
    delete state.conversationPaused;
    if (state.processes) {
        delete state.processes.pendingClarification;
        delete state.processes.informationOnly;
    }
    return { ...params, state };
}
