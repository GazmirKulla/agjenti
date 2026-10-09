import { businessProfiles } from "./rules";

export const detailFields = {
  businessCategory: "Kategoria e biznesit",
  businessDescription: "Përshkrimi i biznesit",
  offeringsSummary: "Produktet ose shërbimet që ofron",
  customerQuestions: "Pyetjet e shpeshta dhe përgjigjet",
  customerProcess: "Si funksionon porosia ose rezervimi",
  handoffRules: "Ndihma nga Agjenti dhe kalimi te stafi",
  sellsProducts: "A shet edhe produkte?",
  hasVariants: "A kanë produktet variante?",
  isPersonalized: "A ofron personalizim?",
} as const;
export type BusinessDetails = {
  businessCategory: string | null;
  businessDescription: string | null;
  offeringsSummary: string[] | null;
  customerQuestions: string | null;
  customerProcess: string | null;
  handoffRules: string | null;
  sellsProducts: boolean | null;
  hasVariants: boolean | null;
  isPersonalized: boolean | null;
};
export const emptyDetails: BusinessDetails = {
  businessCategory: null,
  businessDescription: null,
  offeringsSummary: null,
  customerQuestions: null,
  customerProcess: null,
  handoffRules: null,
  sellsProducts: null,
  hasVariants: null,
  isPersonalized: null,
};
export const audioFields = [
  "name",
  "businessType",
  "offeringTypes",
  "useCases",
  "agentCapabilities",
  "productCount",
  "messageVolume",
  "teamSize",
  ...Object.keys(detailFields),
] as const;
export type AudioField = string;
export type AudioReview = {
  analysisIds: string[];
  confidence: Record<string, number>;
  confirmedFields: string[];
  corrections: Record<string, string | string[] | boolean | null>;
  reviewed: boolean;
};
export const CONFIRM_THRESHOLD = 0.8;
export function parseDetails(raw: unknown): BusinessDetails {
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (key: string, max: number) =>
    typeof data[key] === "string"
      ? (data[key] as string).trim().slice(0, max) || null
      : null;
  const category = text("businessCategory", 60);
  return {
    businessCategory:
      category && Object.hasOwn(businessProfiles, category) ? category : null,
    businessDescription: text("businessDescription", 2000),
    customerQuestions: text("customerQuestions", 2000),
    customerProcess: text("customerProcess", 2000),
    handoffRules: text("handoffRules", 2000),
    offeringsSummary: Array.isArray(data.offeringsSummary)
      ? [
          ...new Set(
            data.offeringsSummary
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim().slice(0, 160))
              .filter(Boolean),
          ),
        ].slice(0, 30)
      : null,
    sellsProducts:
      typeof data.sellsProducts === "boolean" ? data.sellsProducts : null,
    hasVariants:
      typeof data.hasVariants === "boolean" ? data.hasVariants : null,
    isPersonalized:
      typeof data.isPersonalized === "boolean" ? data.isPersonalized : null,
  };
}
export function parseAudioReview(raw: unknown): AudioReview | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.analysisIds)) return undefined;
  const ids = data.analysisIds
    .filter(
      (v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
    )
    .slice(-12);
  if (!ids.length) return undefined;
  const confidence: Record<string, number> = {};
  const corrections: AudioReview["corrections"] = {};
  for (const field of audioFields) {
    const score = (data.confidence as Record<string, unknown> | undefined)?.[
      field
    ];
    if (typeof score === "number" && Number.isFinite(score))
      confidence[field] = Math.max(0, Math.min(1, score));
    const value = (data.corrections as Record<string, unknown> | undefined)?.[
      field
    ];
    if (value === null || typeof value === "boolean")
      corrections[field] = value;
    else if (typeof value === "string")
      corrections[field] = value.slice(0, 2000);
    else if (Array.isArray(value))
      corrections[field] = value
        .filter((v): v is string => typeof v === "string")
        .slice(0, 30)
        .map((v) => v.slice(0, 160));
  }
  return {
    analysisIds: ids,
    confidence,
    corrections,
    confirmedFields: Array.isArray(data.confirmedFields)
      ? data.confirmedFields
          .filter(
            (v): v is string =>
              typeof v === "string" && audioFields.includes(v),
          )
          .slice(0, audioFields.length)
      : [],
    reviewed: data.reviewed === true,
  };
}
export function pendingConfirmations(review: AudioReview): string[] {
  return Object.entries(review.confidence)
    .filter(
      ([key, value]) =>
        value < CONFIRM_THRESHOLD &&
        !review.confirmedFields.includes(key) &&
        !Object.hasOwn(review.corrections, key),
    )
    .map(([key]) => key);
}

export function detailConflicts(answers: {
  details?: BusinessDetails;
  offeringTypes: string[];
}) {
  const details = answers.details;
  const conflicts: { field: string; message: string }[] = [];
  if (!details) return conflicts;
  const productOffers = answers.offeringTypes.some((v) => v !== "services");
  if (
    (details.sellsProducts === false && productOffers) ||
    (details.sellsProducts === true &&
      answers.offeringTypes.length === 1 &&
      answers.offeringTypes[0] === "services")
  )
    conflicts.push({
      field: "offeringTypes",
      message:
        "Oferta dhe përgjigjja për shitjen e produkteve nuk përputhen. Rishiko njërën prej tyre.",
    });
  if (
    details.hasVariants === false &&
    answers.offeringTypes.includes("variants")
  )
    conflicts.push({
      field: "hasVariants",
      message:
        "Ke zgjedhur produkte me variante, por ke shënuar se nuk kanë variante. Saktëso përgjigjen.",
    });
  if (
    details.isPersonalized === false &&
    answers.offeringTypes.some((v) =>
      ["photo", "text", "personalized"].includes(v),
    )
  )
    conflicts.push({
      field: "isPersonalized",
      message:
        "Ke zgjedhur personalizim në ofertë. Saktëso nëse produktet janë të personalizuara.",
    });
  return conflicts;
}
