import { createHash } from "node:crypto";
import { foldText, type ConversationStatePayload } from "./engine";
import { setFact, isQuestion } from "./context";
import { customerDeclaredKeys, validDeclaredValue, type CustomerDeclaredKey } from "./customer-declared-facts";
import { parseFieldCandidates, type CandidateField, type FieldCandidate } from "./field-candidates";

export type QuestionField = "name" | CustomerDeclaredKey;
export type PendingCustomerQuestion = {
  kind: "customer_facts"; businessId: string; fields: QuestionField[];
  prompt: string; expiresAt: number; labelsOnly?: true; clarificationAttempts?: number;
};
const clarificationHeader = "Për të shmangur ngatërrimin, shkruaj me etiketa:";
const unclearReply = "Përgjigjja mbetet e paqartë. Mund ta japësh një të dhënë me etiketën e saj ose të vazhdosh me një pyetje tjetër.";
const labels: Record<QuestionField, string> = { name: "Emri", business_type: "Lloji i biznesit", instagram_handle: "Instagram", stated_needs: "Pyetjet tipike" };
const allowed = (key: string): key is QuestionField => key === "name" || customerDeclaredKeys.includes(key as CustomerDeclaredKey);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const customerQuestionInstruction = "When a relevant informational conversation needs the customer's own name, business type, Instagram profile or common questions, request only missing fields using ONE [[ask_customer:name,business_type,instagram_handle,stated_needs]] slot (choose a subset in the intended order). Do not write an untracked multi-field question. This slot is a request to the server, never authority to store facts or execute actions. Do not use it during a business process or for unrelated qualification.";

function free(state: ConversationStatePayload) {
  return !state.staffHandoff && !state.conversationPaused && state.visual?.status !== "handoff" && !state.visual?.awaiting
    && !state.processes?.active && !state.processes?.pendingClarification && !state.processes?.pendingChoice
    && !(["order", "booking", "service", "actionFlow"] as const).some(k => {
      const p = state.processes?.[k]; return p && ("status" in p ? p.status === "active" || p.status === "suspended" : p.visual.status !== "completed");
    });
}
function prompt(fields: QuestionField[], labelled = false) {
  return `${labelled ? "Për të shmangur ngatërrimin, shkruaj me etiketa" : "Shkruaj nga një përgjigje në çdo rresht, në këtë rend (ose përdor etiketat)"}:\n${fields.map(k => `${labels[k]}:`).join("\n")}`;
}
function known(state: ConversationStatePayload, key: QuestionField) { return key === "name" ? state.context?.profile.name : state.customerDeclaredFacts?.[key]; }

/** Called by the coordinator on the final, validated reply, before persistence.
 * Only allowlisted model slot proposals are rendered by the SERVER. Never scan
 * old prose or trust a client-provided question. Transport delivery is checked on
 * consumption (or the authenticated sealed test session). No extra facts store. */
export function renderCustomerQuestion(state: ConversationStatePayload, reply: string, businessId: string, eligible: boolean, now = Date.now()) {
  delete state.pendingCustomerQuestion;
  const slots = [...reply.matchAll(/\[\[ask_customer:([^\]]*)\]\]/g)];
  if (!slots.length) return reply;
  const fields = slots[0][1].split(",").map(k => k.trim());
  if (!eligible || !free(state) || slots.length !== 1 || fields.length > 4 || !fields.length
    || fields.some(k => !allowed(k)) || new Set(fields).size !== fields.length) {
    return reply.replace(/\[\[ask_customer:[^\]]*\]\]/g, "").trim() || "Çfarë informacioni dëshiron?";
  }
  const missing = (fields as QuestionField[]).filter(k => !known(state, k));
  if (!missing.length) return reply.replace(slots[0][0], "Këto të dhëna i ke dhënë tashmë.");
  const rendered = reply.replace(slots[0][0], prompt(missing));
  if (rendered.length > 1200) return reply.replace(slots[0][0], "Mund t’i japësh të dhënat me etiketa.");
  state.pendingCustomerQuestion = { kind: "customer_facts", businessId, fields: missing, prompt: rendered, expiresAt: now + 15 * 60000 };
  return rendered;
}

function semanticValue(key: QuestionField, value: string, labelled: boolean) {
  const text = foldText(value);
  if (/^(?:ignore|ignoro|anulo|leje|vazhdo|rezervo|porosit|http|www|po$|jo$|ok$)/.test(text)) return false;
  if (key === "name") return /^[\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){0,3}$/u.test(value)
    && !/\b(?:shitje|shes|online|biznes|dyqan|pyetje|kam|ofroj|sherbime|hello|pershendetje)\b/.test(text);
  if (!validDeclaredValue(key, value)) return false;
  if (labelled) return true;
  // Unlabelled free text is deliberately conservative. Unsupported descriptions
  // must be labelled, not guessed from a person's name or arbitrary paragraphs.
  if (key === "instagram_handle") return /[@_.]/.test(value);
  if (key === "business_type") return /^(?:shitje|shes|ofroj|ofrojme|prodhoj|merrem me|punoj si|dyqan|studio|retail|selling|online)\b/.test(text);
  return true; // A question/example is data in a needs field, not a navigation command.
}

// Adapter for the existing conversation-local declaration contract. Configured
// process fields use their own definitions/owners through extractMessageFacts;
// a model slot cannot expand this allowlist or create a new persistence target.
function definition(key: QuestionField): CandidateField {
  return { key, label: labels[key], type: "text", maxLength: 300,
    allowQuestions: key === "stated_needs",
    validate: (value, labelled) => semanticValue(key, value, labelled),
    recognizes: key === "stated_needs" ? undefined : value => semanticValue(key, value, false)
      && (key !== "name" || /^\p{Lu}/u.test(value)),
  };
}

export function consumeCustomerQuestion(state: ConversationStatePayload, input: { businessId: string; message: string; deliveredReply?: string | null; test: boolean; now?: number }): { reply: string; accepted: number; fields?: FieldCandidate[] } | null {
  const q = state.pendingCustomerQuestion;
  delete state.pendingCustomerQuestion; // One next turn only; never resurrect old prompts.
  if (!q) return null;
  const previous = state.recentMessages?.at(-1);
  if (q.kind !== "customer_facts" || q.businessId !== input.businessId || !free(state) || !Number.isFinite(q.expiresAt)
    || q.expiresAt <= (input.now ?? Date.now()) || q.expiresAt > (input.now ?? Date.now()) + 15 * 60000
    || !Array.isArray(q.fields) || !q.fields.length || q.fields.length > 4 || q.fields.some(k => !allowed(k))
    || new Set(q.fields).size !== q.fields.length || typeof q.prompt !== "string" || q.prompt.length > 1200
    || q.clarificationAttempts !== undefined && (!Number.isInteger(q.clarificationAttempts) || q.clarificationAttempts < 0 || q.clarificationAttempts >= 2)
    || previous?.role !== "assistant" || previous.content !== q.prompt || !input.test && input.deliveredReply !== q.prompt) return null;
  const lines = input.message.split(/\n|;/).map(v => v.trim()).filter(Boolean);
  const expectedLabel = (line: string) => line.includes(":") && Object.values(labels).some(label => foldText(line.slice(0, line.indexOf(":")).trim()) === foldText(label));
  // Navigation/questions are left to the existing coordinator, not consumed as facts.
  const explicitAnswer = lines[0] === clarificationHeader || lines.some(expectedLabel)
    || q.fields.length === 1 && q.fields[0] === "stated_needs";
  if (!lines.length || !explicitAnswer && (isQuestion(lines[0]) || /^(?:leje fare|anulo|vazhdo|dua |me lidh|ta bejme|pershendetje)/.test(foldText(lines[0])))) return null;
  // Cancellation is never a needs example just because that is the final field.
  if (/^(?:leje fare|anulo)[.!\s]*$/.test(foldText(input.message))) return null;
  if (state.lastCustomerAnswerHash === digest(input.message)) {
    const attempts = (q.clarificationAttempts ?? 0) + 1;
    if (attempts < 2) state.pendingCustomerQuestion = { ...q, clarificationAttempts: attempts };
    return { reply: attempts < 2 ? q.prompt : unclearReply, accepted: 0,
      fields: q.fields.map(key => ({ key, status: "missing" })) };
  }
  const keys = [...new Set([...q.fields, ...Object.keys(labels).filter(k => known(state, k as QuestionField))])] as QuestionField[];
  const parsed = parseFieldCandidates(input.message, keys.map(definition), {
    positionalKeys: q.labelsOnly ? undefined : q.fields, knownHeader: clarificationHeader,
  });
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
  const notice = parsed.issues.includes("unknown_content") ? "Teksti pa etiketë të njohur nuk u interpretua. " : "";
  const reply = notice + (remaining.length
    ? attempts >= 2 ? unclearReply
      : prompt(remaining, !accepted.length || parsed.fields.some(f => f.status === "invalid" || f.status === "ambiguous"))
    : "Faleminderit për deklarimet. Kjo nuk krijon regjistrim, porosi apo rezervim.");
  if (remaining.length && attempts < 2) state.pendingCustomerQuestion = { ...q, fields: remaining, prompt: reply,
    clarificationAttempts: attempts, labelsOnly: !accepted.length || parsed.fields.some(f => f.status === "invalid" || f.status === "ambiguous") ? true : undefined };
  return { reply, accepted: accepted.length, fields: parsed.fields };
}
