import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import type { CustomerQuestionProposal } from "@/lib/conversations/communication-contract";
import { createHash } from "node:crypto";
import { type ConversationStatePayload } from "./state";
import { setFact } from "./context";
import { customerDeclaredKeys, validDeclaredValue, type CustomerDeclaredKey } from "./customer-declared-facts";
import { type FieldCandidate } from "./field-candidates";

export type QuestionField = "name" | CustomerDeclaredKey;
export type PendingCustomerQuestion = {
  kind: "customer_facts"; businessId: string; fields: QuestionField[];
  prompt: string; expiresAt: number; presented?: true; labelsOnly?: true; clarificationAttempts?: number;
};
const unclearReply = "Nuk arrita ta kuptoj saktë. Mund ta thuash ndryshe ose të vazhdojmë me pyetjen tënde.";
const labels: Record<QuestionField, string> = { name: "Emri", business_type: "Lloji i biznesit", instagram_handle: "Instagram", stated_needs: "Pyetjet tipike" };
const allowed = (key: string): key is QuestionField => key === "name" || customerDeclaredKeys.includes(key as CustomerDeclaredKey);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const customerQuestionInstruction = "Return the customer_communication object. Put the answer to the customer's current question in answer, using verified business information. Put at most ONE optional follow-up in question, with its field, natural text and purpose; otherwise question is null. Never embed collection questions in answer and never output ask_customer slots. A greeting or a question about how the service works is not a request to register or complete a questionnaire. Never make an explanation conditional on providing personal or business details. Choose only a missing fact useful to this conversation: understand the business or its need before requesting identity or contact details. Do not systematically collect every field. When the customer asks to begin a supported process, do not make optional qualification a prerequisite. Explain the next supported step; required fields and confirmation belong to the existing process. A product explanation does not authorize a process. The question is only a language proposal, never authority to store facts or execute actions. During a business process or unrelated qualification, question must be null.";

function free(state: ConversationStatePayload) {
  return !state.staffHandoff && !state.conversationPaused && state.visual?.status !== "handoff" && !state.visual?.awaiting
    && !state.processes?.active && !state.processes?.pendingClarification && !state.processes?.pendingChoice
    && !(["order", "booking", "service", "actionFlow"] as const).some(k => {
      const p = state.processes?.[k]; return p && ("status" in p ? p.status === "active" || p.status === "suspended" : p.visual.status !== "completed");
    });
}
const questions: Record<QuestionField, string> = {
  name: "Si të quajnë?",
  business_type: "Çfarë biznesi ke?",
  instagram_handle: "Cili është profili i biznesit tënd në Instagram?",
  stated_needs: "Çfarë të pyesin më shpesh klientët?",
};
function prompt(fields: QuestionField[], labelled = false) {
  if (fields.length === 1) return `${labelled ? "Nuk e kuptova saktë. " : ""}${questions[fields[0]]}`;
  // Previously delivered multi-field checkpoints remain readable during rollout.
  return `${labelled ? "Për të shmangur ngatërrimin, shkruaj me etiketa" : "Shkruaj nga një përgjigje në çdo rresht, në këtë rend (ose përdor etiketat)"}:\n${fields.map(k => `${labels[k]}:`).join("\n")}`;
}
function known(state: ConversationStatePayload, key: QuestionField) { return key === "name" ? state.context?.profile.name : state.customerDeclaredFacts?.[key]; }

/** Called by the coordinator on the final, validated reply, before persistence.
 * Only allowlisted model slot proposals are rendered by the SERVER. Never scan
 * old prose or trust a client-provided question. Transport delivery is checked on
 * consumption (or the authenticated sealed test session). No extra facts store. */
export function renderCustomerQuestion(state: ConversationStatePayload, reply: string, businessId: string, eligible: boolean, now = Date.now(), proposal?: CustomerQuestionProposal) {
  if (!eligible || !free(state) || (state.pendingCustomerQuestion && state.pendingCustomerQuestion.expiresAt <= now)) delete state.pendingCustomerQuestion;
  if (proposal) {
    if (!eligible || !free(state) || !allowed(proposal.field) || known(state, proposal.field)) return reply;
    const rendered = [reply.trim(), proposal.text].filter(Boolean).join("\n\n");
    if (rendered.length > 1200) return reply;
    state.pendingCustomerQuestion = { kind: "customer_facts", businessId, fields: [proposal.field], prompt: rendered, expiresAt: now + 15 * 60000 };
    return rendered;
  }
  // Compatibility for already-created test fixtures and persisted old replies.
  // New model output uses the structured proposal above.
  const slots = [...reply.matchAll(/\[\[ask_customer:([^\]]*)\]\]/g)];
  if (!slots.length) return reply;
  const fields = slots[0][1].split(",").map(k => k.trim());
  if (!eligible || !free(state) || slots.length !== 1 || fields.length > 4 || !fields.length
    || fields.some(k => !allowed(k)) || new Set(fields).size !== fields.length) {
    return reply.replace(/\[\[ask_customer:[^\]]*\]\]/g, "").trim() || "Çfarë informacioni dëshiron?";
  }
  const missing = (fields as QuestionField[]).filter(k => !known(state, k)).slice(0, 1);
  if (!missing.length) return reply.replace(slots[0][0], "Këto të dhëna i ke dhënë tashmë.");
  const rendered = reply.replace(slots[0][0], prompt(missing));
  if (rendered.length > 1200) return reply.replace(slots[0][0], "");
  state.pendingCustomerQuestion = { kind: "customer_facts", businessId, fields: missing, prompt: rendered, expiresAt: now + 15 * 60000 };
  return rendered;
}

export function consumeCustomerQuestion(state: ConversationStatePayload, input: { businessId: string; message: string; deliveredReply?: string | null; test: boolean; now?: number }): { reply: string; accepted: number; fields?: FieldCandidate[] } | null {
  const q = state.pendingCustomerQuestion;
  if (!q) return null;
  const previous = state.recentMessages?.at(-1);
  if (q.kind !== "customer_facts" || q.businessId !== input.businessId || !free(state) || !Number.isFinite(q.expiresAt)
    || q.expiresAt <= (input.now ?? Date.now()) || q.expiresAt > (input.now ?? Date.now()) + 15 * 60000
    || !Array.isArray(q.fields) || !q.fields.length || q.fields.length > 4 || q.fields.some(k => !allowed(k))
    || new Set(q.fields).size !== q.fields.length || typeof q.prompt !== "string" || q.prompt.length > 1200
    || q.clarificationAttempts !== undefined && (!Number.isInteger(q.clarificationAttempts) || q.clarificationAttempts < 0 || q.clarificationAttempts >= 2)
    ) { delete state.pendingCustomerQuestion; return null; }
  if (!q.presented) {
    if (previous?.role !== "assistant" || previous.content !== q.prompt || !input.test && input.deliveredReply !== q.prompt) {
      delete state.pendingCustomerQuestion; return null;
    }
    q.presented = true;
  }
  const meaning = messageUnderstanding(input.message);
  if (meaning.navigation === "cancel" || meaning.act === "decline") { delete state.pendingCustomerQuestion; return null; }
  // An information detour or uncertain interpretation preserves the delivered question.
  if (!meaning.facts.length && !meaning.unresolvedFields.length && !meaning.unresolvedInput) return null;
  if (state.lastCustomerAnswerHash === digest(input.message)) {
    const attempts = (q.clarificationAttempts ?? 0) + 1;
    if (attempts < 2) state.pendingCustomerQuestion = { ...q, clarificationAttempts: attempts };
    else delete state.pendingCustomerQuestion;
    return { reply: attempts < 2 ? q.prompt : unclearReply, accepted: 0,
      fields: q.fields.map(key => ({ key, status: "missing" })) };
  }
  const keys = [...new Set([...q.fields, ...Object.keys(labels)])] as QuestionField[];
  const parsed: { fields: FieldCandidate[]; issues: string[] } = { fields: keys.map(key => {
    const f = meaning.facts.find(f => f.key === key);
    if (!f) return { key, status: meaning.unresolvedFields.find(f=>f.key===key)?.reason ?? "missing" };
    const valid = key === "name" ? f.value.trim().length > 0 && f.value.length <= 300 : validDeclaredValue(key, f.value);
    return valid ? { key, status: "accepted", value: f.value } : { key, status: "invalid" };
  }), issues: [] };
  const accepted: QuestionField[] = [];
  for (const [index, field] of parsed.fields.entries()) {
    if (field.status !== "accepted") continue;
    const key = field.key as QuestionField, value = field.value;
    if (key === "name") {
      if (!setFact(state, "customer_name", value, "text", "customer_declaration")) { parsed.fields[index] = { key, status: "invalid" }; continue; }
    }
    else { state.customerDeclaredFacts ??= {}; state.customerDeclaredFacts[key] = { value, type: "text", source: "customer_declaration", validated: true }; }
    accepted.push(key);
  }
  // This mutates a candidate state only. The coordinator/transport must still
  // commit it atomically or seal the authenticated test session before delivery.
  if (accepted.length) state.lastCustomerAnswerHash = digest(input.message);
  const remaining = keys.filter(k => q.fields.includes(k) && !accepted.includes(k)
    || !parsed.issues.includes("ambiguous_layout") && parsed.fields.some(f => f.key === k && ["invalid", "ambiguous"].includes(f.status)));
  // Repeating already-known labels is not progress on the unresolved question.
  const attempts = q.fields.some(key => accepted.includes(key)) ? 0 : (q.clarificationAttempts ?? 0) + 1;
  const notice = meaning.unresolvedInput ? "Një pjesë e përgjigjes nuk u interpretua. " : "";
  const reply = notice + (remaining.length
    ? attempts >= 2 ? unclearReply
      : prompt(remaining, !accepted.length || parsed.fields.some(f => f.status === "invalid" || f.status === "ambiguous"))
    : "Faleminderit, e kuptova.");
  delete state.pendingCustomerQuestion;
  if (remaining.length && attempts < 2) state.pendingCustomerQuestion = { ...q, presented: undefined, fields: remaining, prompt: reply,
    clarificationAttempts: attempts, labelsOnly: !accepted.length || parsed.fields.some(f => f.status === "invalid" || f.status === "ambiguous") ? true : undefined };
  return { reply, accepted: accepted.length, fields: parsed.fields };
}
