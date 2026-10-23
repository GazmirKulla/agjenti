import { createHash } from "node:crypto";
import { foldText, type ConversationStatePayload } from "./engine";
import { setFact, isQuestion } from "./context";
import { customerDeclaredKeys, validDeclaredValue, type CustomerDeclaredKey } from "./customer-declared-facts";

export type QuestionField = "name" | CustomerDeclaredKey;
export type PendingCustomerQuestion = {
  kind: "customer_facts"; businessId: string; fields: QuestionField[];
  prompt: string; expiresAt: number; labelsOnly?: true;
};
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

function valid(key: QuestionField, value: string, labelled: boolean) {
  if (!value || value.length > 300 || /[\x00-\x1f]/.test(value) || isQuestion(value)) return false;
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
  return /^(?:kam pyetje|pyetje|klientet|me pyesin|nevoj|customers|questions)\b/.test(text);
}

export function consumeCustomerQuestion(state: ConversationStatePayload, input: { businessId: string; message: string; deliveredReply?: string | null; test: boolean; now?: number }): { reply: string; accepted: number } | null {
  const q = state.pendingCustomerQuestion;
  delete state.pendingCustomerQuestion; // One next turn only; never resurrect old prompts.
  if (!q) return null;
  const previous = state.recentMessages?.at(-1);
  if (q.kind !== "customer_facts" || q.businessId !== input.businessId || !free(state) || !Number.isFinite(q.expiresAt)
    || q.expiresAt <= (input.now ?? Date.now()) || q.expiresAt > (input.now ?? Date.now()) + 15 * 60000
    || !Array.isArray(q.fields) || !q.fields.length || q.fields.length > 4 || q.fields.some(k => !allowed(k))
    || new Set(q.fields).size !== q.fields.length || typeof q.prompt !== "string" || q.prompt.length > 1200
    || previous?.role !== "assistant" || previous.content !== q.prompt || !input.test && input.deliveredReply !== q.prompt) return null;
  const lines = input.message.split(/\n|;/).map(v => v.trim()).filter(Boolean);
  // Navigation/questions are left to the existing coordinator, not consumed as facts.
  if (!lines.length || isQuestion(lines[0]) || /^(?:leje fare|anulo|vazhdo|dua |me lidh|ta bejme|pershendetje)/.test(foldText(lines[0]))) return null;
  if (state.lastCustomerAnswerHash === digest(input.message)) { state.pendingCustomerQuestion = q; return { reply: q.prompt, accepted: 0 }; }
  const supplied: Array<[QuestionField, string]> = [];
  const labelled = lines.every(line => line.includes(":"));
  if (labelled) {
    for (const line of lines) {
      const index = line.indexOf(":"), label = foldText(line.slice(0, index).trim());
      const key = (Object.keys(labels) as QuestionField[]).find(k => foldText(labels[k]) === label);
      const value = line.slice(index + 1).trim();
      if (!key || !q.fields.includes(key) && !known(state, key) || supplied.some(([k]) => k === key) || !valid(key, value, true)) { supplied.length = 0; break; }
      supplied.push([key, value]);
    }
  } else if (!q.labelsOnly && lines.length <= q.fields.length && lines.every((value, i) => valid(q.fields[i], value, false))) {
    lines.forEach((value, i) => supplied.push([q.fields[i], value]));
  }
  if (!supplied.length) {
    const reply = prompt(q.fields, true);
    state.pendingCustomerQuestion = { ...q, prompt: reply, labelsOnly: true };
    return { reply, accepted: 0 };
  }
  for (const [key, value] of supplied) {
    if (key === "name") setFact(state, "customer_name", value, "text", "customer_declaration");
    else { state.customerDeclaredFacts ??= {}; state.customerDeclaredFacts[key] = { value, type: "text", source: "customer_declaration", validated: true }; }
  }
  state.lastCustomerAnswerHash = digest(input.message);
  const remaining = q.fields.filter(k => !supplied.some(([key]) => key === k));
  const reply = remaining.length ? prompt(remaining) : "Faleminderit, i ruajta deklarimet në këtë bisedë. Kjo nuk krijon regjistrim, porosi apo rezervim.";
  if (remaining.length) state.pendingCustomerQuestion = { ...q, fields: remaining, prompt: reply };
  return { reply, accepted: supplied.length };
}
