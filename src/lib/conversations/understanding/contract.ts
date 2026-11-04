/** Semantic observations are never effect permission or persisted business state. */
export const intents = ["information", "order", "booking", "service", "support", "undetermined"] as const;
export const acts = ["answer", "accept", "decline", "acknowledge", "question", "uncertain", "other"] as const;
export const navigationKinds = ["resume", "cancel", "defer", "information_only", "correct", "back", "new", "skip", "none"] as const;
export const processKinds = ["order", "booking", "service", "actionFlow"] as const;
export type MessageUnderstanding = {
  intent: typeof intents[number]; act: typeof acts[number]; navigation: typeof navigationKinds[number];
  process: typeof processKinds[number] | null;
  question: boolean; staffContact: boolean; bookingMention: boolean; existingBookingChange: boolean;
  orderStatus: boolean; statusReference: string | null;
  referenceKind: "product" | "service" | null; referenceIndex: number | null;
  positiveEntityText: string; correction: boolean;
  recallKeys: string[]; recallProcess: boolean; recall: boolean; salesLocation: boolean;
  requestedFields: string[];
  facts: { key: string; value: string; evidence: string }[];
  evidence: string;
};
export const unknownUnderstanding: MessageUnderstanding = Object.freeze({ intent: "undetermined", act: "uncertain", navigation: "none", process: null,
  question: false, staffContact: false, bookingMention: false, existingBookingChange: false, orderStatus: false, statusReference: null,
  referenceKind: null, referenceIndex: null, positiveEntityText: "", correction: false, recallKeys: [], recallProcess: false, recall: false,
  salesLocation: false, requestedFields: [], facts: [], evidence: "" });
const strings = { type: "array", items: { type: "string" } };
const properties = {
  intent: { type: "string", enum: intents }, act: { type: "string", enum: acts }, navigation: { type: "string", enum: navigationKinds },
  process: { type: ["string", "null"], enum: [...processKinds, null] },
  ...Object.fromEntries(["question", "staffContact", "bookingMention", "existingBookingChange", "orderStatus", "correction", "recallProcess", "recall", "salesLocation"].map(k => [k, { type: "boolean" }])),
  statusReference: { type: ["string", "null"] }, referenceKind: { type: ["string", "null"], enum: ["product", "service", null] },
  referenceIndex: { type: ["integer", "null"] }, positiveEntityText: { type: "string" }, recallKeys: strings, requestedFields: strings,
  facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value", "evidence"], properties: { key: { type: "string" }, value: { type: "string" }, evidence: { type: "string" } } } },
  evidence: { type: "string" },
};
export const understandingSchema = { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
export function parseUnderstanding(raw: unknown, message: string, fields: readonly string[]): MessageUnderstanding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as MessageUnderstanding;
  if (Object.keys(v).length !== Object.keys(properties).length || Object.keys(v).some(k => !Object.hasOwn(properties, k))
    || !intents.includes(v.intent) || !acts.includes(v.act) || !navigationKinds.includes(v.navigation) || v.process !== null && !processKinds.includes(v.process)
    || ["question", "staffContact", "bookingMention", "existingBookingChange", "orderStatus", "correction", "recallProcess", "recall", "salesLocation"].some(k => typeof (v as unknown as Record<string,unknown>)[k] !== "boolean")
    || ![null, "product", "service"].includes(v.referenceKind) || v.referenceIndex !== null && (!Number.isInteger(v.referenceIndex) || v.referenceIndex < 1 || v.referenceIndex > 10)
    || v.statusReference !== null && (typeof v.statusReference !== "string" || v.statusReference.length > 36)
    || typeof v.positiveEntityText !== "string" || v.positiveEntityText.length > message.length || v.positiveEntityText && !message.includes(v.positiveEntityText)
    || typeof v.evidence !== "string" || !v.evidence.trim() || !message.includes(v.evidence)
    || !Array.isArray(v.facts) || v.facts.length > 32 || !Array.isArray(v.recallKeys) || v.recallKeys.length > 32
    || !Array.isArray(v.requestedFields) || v.requestedFields.length > 32) return null;
  if ([...v.recallKeys,...v.requestedFields].some(k => typeof k !== "string" || !fields.includes(k))) return null;
  if (v.facts.some(f => !f || Object.keys(f).some(k => !["key","value","evidence"].includes(k)) || !fields.includes(f.key)
    || typeof f.value !== "string" || !f.value.trim() || f.value.length > 2000 || typeof f.evidence !== "string" || !f.evidence.trim()
    || !message.includes(f.evidence) || !f.evidence.includes(f.value))) return null;
  if (new Set(v.facts.map(f=>f.key)).size !== v.facts.length) return null;
  return v;
}
