import type { ContinuationAnswer, ContinuationProgress, ContinuationQuestion } from "./continuation";

/** An onboarding question asked as an assistant message. Clients render the
 * options as quick replies; the server stays the only judge of valid answers. */
export type OnboardingQuestionMeta = {
  type: "onboarding_question";
  version: 1;
  field: string;
  kind: ContinuationQuestion["kind"];
  options: { value: string; label: string }[];
  progress: ContinuationProgress;
};
/** A quick reply sent by a client together with the conversation turn. */
export type OnboardingQuickReply = { field: string; values?: string[]; skip?: true };

export const ONBOARDING_TITLE = "Profili i biznesit";
export const SKIP_LABEL = "Më vonë";

export function questionMeta(question: ContinuationQuestion, progress: ContinuationProgress): OnboardingQuestionMeta {
  return { type: "onboarding_question", version: 1, field: question.field, kind: question.kind, options: question.options, progress };
}

export function questionContent(question: ContinuationQuestion, lead = "") {
  return `${lead}${question.title}${question.hint ? `\n${question.hint}` : ""}`.slice(0, 2000);
}

export function parseQuestionMeta(value: unknown): OnboardingQuestionMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "onboarding_question" || typeof raw.field !== "string" || !Array.isArray(raw.options)) return null;
  return raw as OnboardingQuestionMeta;
}

/** The question waiting for an answer: the last message, while no turn is running. */
export function pendingQuestion(view: { conversation: { pending_request: string | null }; messages: { kind: string; meta?: unknown }[] }) {
  if (view.conversation.pending_request) return null;
  const last = view.messages.at(-1);
  return last?.kind === "onboarding" ? parseQuestionMeta(last.meta) : null;
}

export function parseQuickReply(value: unknown): OnboardingQuickReply | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_quick_reply");
  const raw = value as Record<string, unknown>;
  if (typeof raw.field !== "string" || raw.field.length > 60) throw new Error("invalid_quick_reply");
  if (raw.skip === true) return { field: raw.field, skip: true };
  if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > 20 || raw.values.some((v) => typeof v !== "string" || v.length > 60))
    throw new Error("invalid_quick_reply");
  return { field: raw.field, values: raw.values as string[] };
}

/** What the person's quick reply says, in their words, for the conversation log. */
export function quickReplyLabel(meta: OnboardingQuestionMeta, reply: OnboardingQuickReply) {
  if (reply.skip) return SKIP_LABEL;
  return (reply.values ?? []).map((v) => meta.options.find((o) => o.value === v)?.label ?? v).join(", ");
}

export function quickReplyAnswer(reply: OnboardingQuickReply): ContinuationAnswer {
  return reply.skip ? { skip: true } : { values: reply.values ?? [] };
}

const skipPattern = /^(m[eë] von[eë]|kalo|kaloje|tjetra|skip|later|nuk e di|s'?e di|nuk di)[.!]?$/i;
const normalize = (text: string) => text.trim().toLocaleLowerCase("sq").replace(/[.!]+$/, "");

/** Answers that need no model: an exact option, yes/no, or an explicit skip. */
export function directAnswer(meta: OnboardingQuestionMeta, text: string): ContinuationAnswer | null {
  const value = normalize(text);
  if (!value) return null;
  if (skipPattern.test(value)) return { skip: true };
  const option = meta.options.find((o) => normalize(o.label) === value || o.value === value);
  if (option) return { values: [option.value] };
  if (meta.kind === "boolean") {
    if (/^(po|yes|sigurisht|patjet[eë]r)$/.test(value)) return { values: ["true"] };
    if (/^(jo|no|aspak)$/.test(value)) return { values: ["false"] };
  }
  return null;
}
