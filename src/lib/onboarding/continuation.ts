import { parseAnswers, type AnswerKey, type Answers } from "./model";
import { conversationQuestions } from "./conversation";
import { correctField, fieldValue, hasValue } from "./audio-model";

/** Onboarding continues inside the dashboard: the agent asks, one at a time,
 * every question the manual flow left empty or the person skipped. */
export type ContinuationQuestion = {
  field: string;
  title: string;
  hint: string;
  kind: "single" | "multiple" | "boolean" | "text" | "list";
  options: { value: string; label: string }[];
  /** Asked during onboarding; the others wait in the "Gati për klientët" card. */
  core: boolean;
  /** Where it is asked: the business profile, or the agent's instructions
   * (what the agent does and when it hands over), which it then updates. */
  step: "profile" | "agent";
};
export type ContinuationAnswer =
  | { skip: true }
  | { values: string[] }
  | { text: string };
export type ContinuationProgress = { answered: number; total: number };

export class ContinuationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const booleanFields = new Set(["hasVariants", "isPersonalized", "sellsProducts"]);
/** Questions about the agent, asked with its instructions (Udhëzimet). */
export const AGENT_FIELDS = new Set(["useCases", "handoffRules"]);
const yesNo = [{ value: "true", label: "Po" }, { value: "false", label: "Jo" }];
// Collected before the workspace exists, or only meaningful for the retired audio review.
// Not asked either, though answers given earlier are kept: frequent questions
// (they belong in Knowledge, many pairs, later from real conversations),
// variants and personalization (they follow from the offer and the scan),
// whether products are sold (the offer question says it), catalogs (asked
// when one is uploaded), the description (the knowledge review covers it) and
// what is sold in words (products go in the list, the scan writes the rest).
const excluded = new Set([
  "name", "businessCategory", "supplement",
  "customerQuestions", "hasVariants", "isPersonalized", "sellsProducts", "catalogContext", "businessDescription", "offeringsSummary",
]);

export function continuationQuestions(
  answers: Answers,
  enabled: readonly AnswerKey[],
): ContinuationQuestion[] {
  return conversationQuestions(answers, enabled)
    .filter((q) => !excluded.has(q.field))
    .filter((q, index, all) => all.findIndex((o) => o.field === q.field) === index)
    .map((q) => ({
      field: q.field,
      title: q.title,
      hint: q.hint,
      core: !!q.core,
      step: AGENT_FIELDS.has(q.field) ? "agent" as const : "profile" as const,
      // Yes/no questions read from the profile carry no options of their own.
      options: booleanFields.has(q.field) && !q.options.length ? yesNo : q.options,
      kind: booleanFields.has(q.field)
        ? "boolean"
        : q.field === "offeringsSummary"
          ? "list"
          : !q.options.length
            ? "text"
            : q.multiple
              ? "multiple"
              : "single",
    }));
}

export function continuationState(answers: Answers, enabled: readonly AnswerKey[]) {
  const questions = continuationQuestions(answers, enabled);
  const skipped = new Set(answers.conversationSkipped ?? []);
  const open = questions.filter((q) => !hasValue(fieldValue(answers, q.field)));
  return {
    question: open.find((q) => !skipped.has(q.field)) ?? null,
    progress: {
      answered: questions.length - open.length,
      total: questions.length,
    } satisfies ContinuationProgress,
  };
}

/** Every profile question with its state and current answer, for the setup
 * card: the next one to ask, the ones answered (to change) and the progress. */
export type ContinuationItem = ContinuationQuestion & {
  status: "answered" | "skipped" | "open";
  /** Chosen option values, or the written text (a list is one item per line). */
  value: string[] | string | null;
  /** The answer as the owner reads it. */
  answer: string;
};

export function continuationOverview(answers: Answers, enabled: readonly AnswerKey[]) {
  const skipped = new Set(answers.conversationSkipped ?? []);
  const items: ContinuationItem[] = continuationQuestions(answers, enabled).map((q) => {
    const raw = fieldValue(answers, q.field);
    if (!hasValue(raw)) return { ...q, status: skipped.has(q.field) ? "skipped" : "open", value: null, answer: "" };
    const value = q.kind === "text" || q.kind === "list"
      ? (Array.isArray(raw) ? raw.map(String).join("\n") : String(raw))
      : Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const answer = Array.isArray(value)
      ? value.map((v) => q.options.find((o) => o.value === v)?.label ?? v).join(", ")
      : value.split("\n").filter(Boolean).join(", ");
    return { ...q, status: "answered", value, answer: answer.slice(0, 300) };
  });
  return { ...continuationState(answers, enabled), items };
}

export function applyContinuationAnswer(
  answers: Answers,
  enabled: readonly AnswerKey[],
  field: unknown,
  answer: unknown,
): Answers {
  const question = continuationQuestions(answers, enabled).find((q) => q.field === field);
  if (!question) throw new ContinuationError("Kjo pyetje nuk është më e hapur. Rifresko panelin.", 409);
  const input = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const skipped = (answers.conversationSkipped ?? []).filter((key) => key !== question.field);
  if (input.skip === true)
    return parseAnswers({ ...answers, conversationSkipped: [...skipped, question.field] });

  let value: string | string[] | boolean;
  if (question.kind === "text" || question.kind === "list") {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new ContinuationError("Shkruaj një përgjigje ose kalo pyetjen.");
    if (text.length > 2000) throw new ContinuationError("Përgjigjja duhet të ketë deri në 2,000 karaktere.");
    value = question.kind === "list"
      ? [...new Set(text.split(/\n|;/).map((item) => item.trim().slice(0, 160)).filter(Boolean))].slice(0, 30)
      : text;
  } else {
    const values = Array.isArray(input.values) ? input.values : [];
    const allowed = new Set(question.options.map((o) => o.value));
    if (!values.length || values.some((v) => typeof v !== "string" || !allowed.has(v)))
      throw new ContinuationError("Zgjidh një nga alternativat.");
    if (question.kind !== "multiple" && values.length !== 1)
      throw new ContinuationError("Zgjidh vetëm një alternativë.");
    const chosen = [...new Set(values as string[])];
    value = question.kind === "boolean"
      ? chosen[0] === "true"
      : question.kind === "multiple" || question.field === "offeringTypes"
        ? chosen
        : chosen[0];
  }
  try {
    return parseAnswers({ ...correctField(answers, question.field, value), conversationSkipped: skipped });
  } catch (error) {
    throw new ContinuationError(error instanceof Error ? error.message : "Kontrollo përgjigjen.");
  }
}

/** Answers that change which dashboard modules make sense for the business. */
export function changesDashboardSignals(before: Answers, after: Answers) {
  return (["businessType", "offeringTypes", "useCases"] as const).some(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
