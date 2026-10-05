import {
  activeQuestions,
  allQuestionKeys,
  parseAnswers,
  questions,
  type Answers,
} from "./model";
import {
  audioFields,
  detailFields,
  emptyDetails,
  parseDetails,
  detailConflicts,
  type AudioReview,
} from "./audio-fields";
import {
  businessProfiles,
  offeringChoices,
  useCaseChoices,
  capabilityChoices,
  normalizeConditionalAnswers,
} from "./rules";

export type ExtractedField = {
  value: string | string[] | boolean | null;
  confidence: number;
  evidence: string | null;
};
export type Extraction = Record<string, ExtractedField>;
const enums: Record<string, readonly string[]> = {
  businessType: Object.keys(businessProfiles),
  businessCategory: Object.keys(businessProfiles),
  offeringTypes: offeringChoices.map((v) => v[0]),
  useCases: useCaseChoices.map((v) => v[0]),
  agentCapabilities: capabilityChoices.map((v) => v[0]),
  ...Object.fromEntries(
    questions
      .filter((q) =>
        ["productCount", "messageVolume", "teamSize"].includes(q.key),
      )
      .map((q) => [q.key, q.options.map((v) => v[0])]),
  ),
};
const arrays = new Set([
  "offeringTypes",
  "useCases",
  "agentCapabilities",
  "offeringsSummary",
]);
const booleans = new Set(["sellsProducts", "hasVariants", "isPersonalized"]);
export const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [...audioFields],
  properties: Object.fromEntries(
    audioFields.map((key) => [
      key,
      {
        type: "object",
        additionalProperties: false,
        required: ["value", "confidence", "evidence"],
        properties: {
          value: arrays.has(key)
            ? {
                type: ["array", "null"],
                items: {
                  type: "string",
                  ...(enums[key] ? { enum: enums[key] } : {}),
                },
              }
            : booleans.has(key)
              ? { type: ["boolean", "null"] }
              : {
                  type: ["string", "null"],
                  ...(enums[key] ? { enum: [...enums[key], null] } : {}),
                },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: ["string", "null"] },
        },
      },
    ]),
  ),
};
/** Validate provider output again; unsupported or unevidenced fields stay unknown. */
export function validateExtraction(
  raw: unknown,
  transcript: string,
): Extraction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("invalid_extraction");
  const result: Extraction = {};
  for (const key of audioFields) {
    const field = (raw as Record<string, ExtractedField>)[key];
    if (
      !field ||
      typeof field !== "object" ||
      typeof field.confidence !== "number" ||
      !Number.isFinite(field.confidence)
    )
      throw new Error("invalid_extraction");
    const v = field.value;
    const valid =
      v === null ||
      (arrays.has(key)
        ? Array.isArray(v) &&
          v.length <= 30 &&
          v.every(
            (item) =>
              typeof item === "string" &&
              item.length <= 160 &&
              (!enums[key] || enums[key].includes(item)),
          )
        : booleans.has(key)
          ? typeof v === "boolean"
          : typeof v === "string" &&
            v.length <= (key === "businessDescription" ? 2000 : 100) &&
            (!enums[key] || enums[key].includes(v)));
    if (!valid) throw new Error("invalid_extraction");
    const evidence =
      typeof field.evidence === "string" ? field.evidence.trim() : "";
    const supported =
      evidence.length > 1 &&
      transcript.toLocaleLowerCase().includes(evidence.toLocaleLowerCase());
    result[key] =
      supported && v !== null
        ? {
            value: v,
            confidence: Math.max(0, Math.min(1, field.confidence)),
            evidence,
          }
        : { value: null, confidence: 0, evidence: null };
  }
  return result;
}
export function fieldValue(
  answers: Answers,
  key: string,
): string | string[] | boolean | null {
  return (
    (key in detailFields
      ? (answers.details ?? emptyDetails)[key as keyof typeof detailFields]
      : (
          answers as unknown as Record<
            string,
            string | string[] | boolean | null
          >
        )[key]) ?? null
  );
}
export function hasValue(value: unknown) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}
export function mergeExtraction(
  current: Answers,
  extraction: Extraction,
  analysisId: string,
): Answers {
  const previous = current.audioReview;
  const review: AudioReview = {
    analysisIds: [...(previous?.analysisIds ?? []), analysisId].slice(-12),
    confidence: { ...previous?.confidence },
    confirmedFields: [...(previous?.confirmedFields ?? [])],
    corrections: { ...previous?.corrections },
    reviewed: false,
  };
  // An existing manual draft is authoritative before the first recording.
  if (!previous)
    for (const key of audioFields) {
      const v = fieldValue(current, key);
      if (hasValue(v)) review.corrections[key] = v;
    }
  const next = {
    ...current,
    details: { ...emptyDetails, ...current.details },
    audioReview: review,
  };
  for (const key of audioFields) {
    const field = extraction[key];
    if (
      !field ||
      !hasValue(field.value) ||
      Object.hasOwn(review.corrections, key)
    )
      continue;
    const old = fieldValue(next, key);
    const value = Array.isArray(field.value)
      ? [...new Set([...(Array.isArray(old) ? old : []), ...field.value])]
      : key === "businessDescription" &&
          typeof old === "string" &&
          old !== field.value
        ? `${old}\n${field.value}`.slice(0, 2000)
        : field.value;
    if (key in detailFields)
      (next.details as Record<string, unknown>)[key] = value;
    else (next as unknown as Record<string, unknown>)[key] = value;
    // A lower-confidence addition to an array must not hide previously uncertain items.
    review.confidence[key] =
      Array.isArray(value) &&
      hasValue(old) &&
      !review.confirmedFields.includes(key)
        ? Math.min(review.confidence[key] ?? 1, field.confidence)
        : field.confidence;
    review.confirmedFields = review.confirmedFields.filter(
      (item) => item !== key,
    );
  }
  const normalized = normalizeConditionalAnswers(next);
  for (const key of [
    "offeringTypes",
    "useCases",
    "agentCapabilities",
  ] as const) {
    if (JSON.stringify(normalized[key]) !== JSON.stringify(next[key])) {
      review.confidence[key] = 0;
      review.confirmedFields = review.confirmedFields.filter(
        (item) => item !== key,
      );
      // Retain correction history; a changed upstream choice may need reconfirmation.
      delete review.corrections[key];
    }
  }
  normalized.details = parseDetails(normalized.details);
  return parseAnswers(normalized);
}
export function correctField(
  current: Answers,
  key: string,
  value: string | string[] | boolean | null,
): Answers {
  const next = { ...current, details: { ...emptyDetails, ...current.details } };
  if (key in detailFields)
    (next.details as Record<string, unknown>)[key] = value;
  else (next as unknown as Record<string, unknown>)[key] = value;
  if (current.audioReview)
    next.audioReview = {
      ...current.audioReview,
      reviewed: false,
      corrections: { ...current.audioReview.corrections, [key]: value },
      confirmedFields: [
        ...new Set([...current.audioReview.confirmedFields, key]),
      ],
    };
  const parsed = parseAnswers(normalizeConditionalAnswers(next));
  // Keep in-progress spaces/newlines in text editors; saveOnboarding normalizes them.
  if (key === "name" && typeof value === "string") parsed.name = value;
  if (["businessDescription", "offeringsSummary"].includes(key))
    (parsed.details as Record<string, unknown>)[key] = value;
  return parsed;
}
export function clarifications(answers: Answers, enabled = allQuestionKeys) {
  const missing: { field: string; message: string }[] = [];
  if (answers.name.trim().length < 2)
    missing.push({ field: "name", message: "Si quhet biznesi yt?" });
  for (const q of activeQuestions(enabled, answers)) {
    const field =
      q.key === "productType"
        ? "offeringTypes"
        : q.key === "aiMode"
          ? "agentCapabilities"
          : q.key;
    if (!q.optional && !hasValue(fieldValue(answers, field)))
      missing.push({ field, message: q.title });
  }
  if (answers.details?.sellsProducts == null)
    missing.push({
      field: "sellsProducts",
      message:
        "Nuk kuptuam nëse shet edhe produkte. Mund ta sqarosh tani ose ta lësh pa përcaktuar.",
    });
  return [...missing, ...detailConflicts(answers)];
}
