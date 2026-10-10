import {
  activeQuestions,
  type Answers,
  type AnswerKey,
  answerLabel,
} from "./model";
import { audioGuide, reviewDetailFields } from "./audio-guide";
import { clarifications, fieldValue, hasValue } from "./audio-model";
import { detailFields, pendingConfirmations } from "./audio-fields";

export type ConversationQuestion = {
  field: string;
  title: string;
  hint: string;
  optional: boolean;
  options: { value: string; label: string }[];
  multiple?: boolean;
  confirm?: boolean;
};
export function conversationQuestions(
  answers: Answers,
  enabled: readonly AnswerKey[],
): ConversationQuestion[] {
  const core: ConversationQuestion[] = [
    {
      field: "name",
      title: "Si quhet biznesi yt?",
      hint: "Mund të tregosh edhe çfarë ofron biznesi.",
      optional: false,
      options: [],
    },
    ...activeQuestions(enabled, answers).map((q) => ({
      field: q.key === "productType" ? "offeringTypes" : q.key,
      title: q.title,
      hint: q.description,
      optional: !!q.optional,
      options: q.options.map(([value, label]) => ({ value, label })),
      multiple: q.key === "useCases",
    })),
  ];
  const details = audioGuide(
    { ...answers, audioReview: undefined },
    enabled,
  ).map((q) => ({
    field: q.id,
    title: q.title,
    hint: q.hint,
    optional: true,
    options: [],
  }));
  const extra: ConversationQuestion[] = reviewDetailFields(answers)
    .filter(
      ([field]) =>
        !details.some((q) => q.field === field) && field !== "businessCategory",
    )
    .map(([field, title]) => ({
      field,
      title,
      hint: "Mund ta plotësosh tani ose më vonë nga profili i biznesit.",
      optional: true,
      options: ["hasVariants", "isPersonalized", "sellsProducts"].includes(
        field,
      )
        ? [
            { value: "true", label: "Po" },
            { value: "false", label: "Jo" },
          ]
        : [],
    }));
  return [
    ...core.filter((q) => !q.optional),
    ...details,
    ...extra,
    ...core.filter((q) => q.optional),
  ];
}
export function nextConversationQuestion(
  answers: Answers,
  enabled: readonly AnswerKey[],
  skipped: string[] = [],
): ConversationQuestion | null {
  const questions = conversationQuestions(answers, enabled);
  const missing = clarifications(answers, [...enabled])[0];
  if (missing)
    return {
      ...(questions.find((q) => q.field === missing.field) ?? {
        field: missing.field,
        hint: "Saktëso informacionin për të vazhduar.",
        optional: false,
        options: [],
      }),
      title: missing.message,
    };
  const uncertain = answers.audioReview
    ? pendingConfirmations(answers.audioReview).filter(
        (field) =>
          field !== "agentCapabilities" && field !== "businessCategory",
      )
    : [];
  if (uncertain.length) {
    const field = uncertain[0];
    return {
      ...(questions.find((q) => q.field === field) ?? {
        field,
        hint: "",
        optional: false,
        options: [],
      }),
      title: `A është i saktë ky informacion? ${conversationValue(answers, field)}`,
      confirm: true,
    };
  }
  return (
    questions.find(
      (q) =>
        !hasValue(fieldValue(answers, q.field)) && !skipped.includes(q.field),
    ) ?? null
  );
}
export function conversationValue(answers: Answers, field: string): string {
  const value = fieldValue(answers, field);
  const key = field === "offeringTypes" ? "productType" : field;
  if (Array.isArray(value))
    return value.map((v) => answerLabel(key as AnswerKey, v)).join(", ");
  if (typeof value === "boolean") return value ? "Po" : "Jo";
  return typeof value === "string" ? answerLabel(key as AnswerKey, value) : "";
}
export function conversationSummary(
  answers: Answers,
  enabled: readonly AnswerKey[],
) {
  const labels = new Map(
    conversationQuestions(answers, enabled).map((q) => [q.field, q.title]),
  );
  for (const [key, label] of Object.entries(detailFields))
    labels.set(key, label);
  return [...labels]
    .filter(([field]) => field !== "businessCategory")
    .map(([field, label]) => ({
      field,
      label,
      value: conversationValue(answers, field),
    }))
    .filter((row) => row.value);
}
