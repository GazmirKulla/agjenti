import { agentModel } from "@/lib/agents/generate";
import { affirmative, isQuestion } from "@/lib/workflows/context";
import { emptyState, foldText } from "@/lib/workflows/engine";
import { explicitIntent, rememberTurn } from "@/lib/workflows/guidance";
import type { AgentTurnParams, AgentTurnResult } from "./process-agent-turn";
export function shortReply(message: string): boolean {
    const text = foldText(message).trim();
    return affirmative(text) || /^(?:(?:po|yes|ok|okay|jo|no|ne rregull|dakord|faleminderit|flm|rrofsh|thanks|thank you|👍|🙏|😊|❤)[.! ,\s]*)+$/u.test(text);
}
export function explicitContinuation(message: string): boolean {
    const text = foldText(message);
    return explicitIntent(message) === "order" || explicitIntent(message) === "support"
        || /\b(?:vazhdo\w*|rifillo\w*|resume|konfirmoj|dua|rezervo|book)\b.*\b(?:porosi\w*|rezerv\w*|takim\w*|order|booking)\b/.test(text);
}
function deferral(message: string): boolean {
    // Match whole clauses, so a negated or unrelated mention is not a suspension.
    return foldText(message).split(/[\n,;.!]+/).some(part => /^(?:(?:ok|po|jo|faleminderit)\s+)?(?:jo tani|jo per momentin|ndoshta|mbase|nuk e di|s e di|hmm*|maybe|not sure|do ta mendoj|vetem po pyes|thjesht po pyes|nuk dua te vazhdoj|nuk dua te porosis|not now|maybe later|just asking|i will think about it)$/.test(part.trim()));
}
function currentProposal(params: AgentTurnParams): boolean {
    const state = params.state;
    const reply = state?.recentMessages?.at(-1);
    if (reply?.role !== "assistant" || state?.conversationPaused)
        return false;
    // State is committed before delivery. Production must independently prove that
    // this exact last prompt, rather than an older question, was actually sent.
    if (params.mode !== "test" && params.deliveredReply?.slice(0, 1200) !== reply.content)
        return false;
    if (state?.processes && !state.processes.promptOwner && !state.processes.pendingChoice && !state.processes.auxiliary && !state.processes.service?.promptCurrent)
        return false;
    const text = foldText(reply.content);
    const questionEnd = text.lastIndexOf("?");
    const question = questionEnd < 0 ? "" : text.slice(0, questionEnd).split(/[.!?\n]/).at(-1)?.trim() ?? "";
    const afterQuestion = text.slice(questionEnd + 1).trim();
    if (afterQuestion && !/\b(?:shkruaj|pergjigju|reply)\b/.test(afterQuestion))
        return false;
    // Disjunctions need a choice, not a yes. Imperative confirmations are also
    // used by the existing order engine (summary + "Përgjigju me Po").
    if (/\b(?:apo|or|informacion|information|pyetje|questions|shpjegim)\b/.test(question))
        return false;
    const configured = state?.context?.execution.linear?.steps.find(step => step.key === state.step_key);
    const fieldQuestion = configured?.prompt && text.includes(foldText(configured.prompt)) && ["confirm", "choice"].includes(configured.kind);
    return Boolean(fieldQuestion) || /^(?:a (?:deshiron|doni|vlejne|jane te sakta)|do te |deshironi |deshiron |ta |t'i |shall |would you like to (?:order|book)|do you confirm |should |konfirmoni |konfirmon )/.test(question)
        || /(?:konfirm|zevendes|vazhdo|personaliz|te dhena)[\s\S]*(?:shkruaj|pergjigju|reply)[\s\S]*(?:po|yes)[\s\S]*(?:jo|no|korrigjim)/.test(text);
}
/** A deterministic boundary before routing, extraction and side effects. */
export function conversationControl(params: AgentTurnParams): AgentTurnResult | null {
    const pause = deferral(params.message);
    const short = shortReply(params.message) && !params.hasPhoto && !params.hasAttachments;
    if (!pause && !short && !(params.state?.conversationPaused && !isQuestion(params.message) && !explicitContinuation(params.message)))
        return null;
    if (!pause && short && currentProposal(params) && (affirmative(params.message) || /^(jo|no)[.!\s]*$/.test(foldText(params.message))))
        return null;
    const state = structuredClone(params.state ?? emptyState());
    const unclear = Boolean(state.conversationPaused && !short && !pause);
    state.conversationPaused = true;
    if (state.processes) {
        state.processes.promptOwner = null;
        delete state.processes.pendingChoice;
        if (state.processes.service)
            state.processes.service.promptCurrent = false;
    }
    const reply = pause ? "Në rregull, e lëmë këtu për momentin."
        : unclear ? "Dëshiron të vazhdojmë kërkesën e mëparshme, apo po kërkon vetëm informacion?"
            : "Në rregull 😊";
    const reason = pause ? "customer_deferred" : unclear ? "resume_requires_intent" : "acknowledgement_without_current_proposal";
    const decision = { process: "information" as const, action: unclear ? "clarify" as const : "answer" as const, source: "rules" as const, reason, reusedFields: [], missingFields: [] };
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
    return { ...params, state };
}
