/** The model proposes language only. No actions, state writes or authorization
 * can be expressed by this contract. Runtime decisions stay server-owned. */
export const communicationVersion = 1 as const;
export const customerQuestionFields = ["name", "business_type", "instagram_handle", "stated_needs"] as const;
export type CustomerQuestionField = typeof customerQuestionFields[number];
export type CustomerQuestionProposal = {
  field: CustomerQuestionField;
  text: string;
  purpose: "current_request" | "understand_need";
};
export type CommunicationDraft = {
  answer: string;
  question: CustomerQuestionProposal | null;
};

export const communicationSchema = {
  type: "object", additionalProperties: false, required: ["answer", "question"],
  properties: {
    answer: { type: "string" },
    question: { anyOf: [
      { type: "null" },
      { type: "object", additionalProperties: false, required: ["field", "text", "purpose"], properties: {
        field: { type: "string", enum: customerQuestionFields }, text: { type: "string" },
        purpose: { type: "string", enum: ["current_request", "understand_need"] },
      } },
    ] },
  },
} as const;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function parseCommunicationDraft(value: unknown): CommunicationDraft | null {
  if (!record(value) || Object.keys(value).some(k => k !== "answer" && k !== "question")
    || typeof value.answer !== "string" || value.answer.length > 1200 || !Object.hasOwn(value, "question")
    || /\[\[ask_customer:/.test(value.answer)) return null;
  let question: CustomerQuestionProposal | null = null;
  if (value.question !== null) {
    const q = value.question;
    if (!record(q) || Object.keys(q).some(k => !["field", "text", "purpose"].includes(k))
      || !customerQuestionFields.includes(q.field as CustomerQuestionField)
      || !["current_request", "understand_need"].includes(q.purpose as string)
      || typeof q.text !== "string" || !q.text.trim() || q.text.length > 240
      || /[\n\r\[\]<>]|https?:\/\/|www\./i.test(q.text)
      || (q.text.match(/\?/g)?.length ?? 0) !== 1 || !q.text.trim().endsWith("?")) return null;
    question = { field: q.field as CustomerQuestionField, text: q.text.trim(), purpose: q.purpose as CustomerQuestionProposal["purpose"] };
  }
  const answer = value.answer.trim();
  if (!answer || answer.length + (question?.text.length ?? 0) + 2 > 1200) return null;
  return { answer, question };
}

export type CommunicationReceipt = {
  version: typeof communicationVersion;
  source: "model" | "protected" | "fallback";
  questionField: CustomerQuestionField | null;
  /** Observation only. A response receipt never grants effect permission. */
  decisionKind: import("./turn-decision").TurnDecision["kind"];
};
