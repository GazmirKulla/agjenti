/** Semantic observations are never effect permission or persisted business state. */
export const intents = ["information", "order", "booking", "service", "support", "undetermined"] as const;
export const acts = ["answer", "accept", "decline", "acknowledge", "question", "uncertain", "other"] as const;
export const navigationKinds = ["resume", "cancel", "defer", "information_only", "correct", "back", "new", "skip", "none"] as const;
export const processKinds = ["order", "booking", "service", "actionFlow"] as const;
export const referenceModes = ["none", "ordinal", "cheapest", "this", "other", "ambiguous"] as const;
export const businessReads = ["none", "product_count", "cheapest", "most_expensive", "price", "services", "duration", "inventory"] as const;
export type MessageUnderstanding = {
  referenceMode: typeof referenceModes[number]; businessRead: typeof businessReads[number];
  retrievalDomain: "product" | "catalog" | "general"; catalogPurpose: "technical" | "commercial" | "b2b" | null;
  intent: typeof intents[number]; act: typeof acts[number]; navigation: typeof navigationKinds[number];
  process: typeof processKinds[number] | null;
  requestedProcesses: (typeof processKinds[number])[];
  question: boolean; staffContact: boolean; bookingMention: boolean; existingBookingChange: boolean;
  orderStatus: boolean; statusReference: string | null;
  referenceKind: "product" | "service" | null; referenceIndex: number | null;
  positiveEntityText: string; correction: boolean;
  recallKeys: string[]; recallProcess: boolean; recall: boolean; salesLocation: boolean;
  requestedFields: string[];
  facts: { key: string; value: string; evidence: string }[];
  unresolvedFields: { key: string; reason: "invalid" | "ambiguous" }[]; unresolvedInput: boolean;
  evidence: string;
};
export const unknownUnderstanding: MessageUnderstanding = Object.freeze({ requestedProcesses: [], unresolvedFields: [], unresolvedInput: false, referenceMode: "none", businessRead: "none", retrievalDomain: "general", catalogPurpose: null, intent: "undetermined", act: "uncertain", navigation: "none", process: null,
  question: false, staffContact: false, bookingMention: false, existingBookingChange: false, orderStatus: false, statusReference: null,
  referenceKind: null, referenceIndex: null, positiveEntityText: "", correction: false, recallKeys: [], recallProcess: false, recall: false,
  salesLocation: false, requestedFields: [], facts: [], evidence: "" });
const strings = { type: "array", items: { type: "string" } };
const properties = {
  requestedProcesses: { type: "array", items: { type: "string", enum: processKinds } },
  unresolvedInput: { type: "boolean" },
  unresolvedFields: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "reason"],
    properties: { key: { type: "string" }, reason: { type: "string", enum: ["invalid", "ambiguous"] } } } },

  referenceMode: { type: "string", enum: referenceModes }, businessRead: { type: "string", enum: businessReads },
  retrievalDomain: { type: "string", enum: ["product", "catalog", "general"] }, catalogPurpose: { type: ["string", "null"], enum: ["technical", "commercial", "b2b", null] },
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
    || !referenceModes.includes(v.referenceMode) || !businessReads.includes(v.businessRead) || !["product","catalog","general"].includes(v.retrievalDomain) || ![null,"technical","commercial","b2b"].includes(v.catalogPurpose)
    || v.referenceMode === "ordinal" && v.referenceIndex === null
    || !intents.includes(v.intent) || !acts.includes(v.act) || !navigationKinds.includes(v.navigation) || v.process !== null && !processKinds.includes(v.process)
    || ["question", "staffContact", "bookingMention", "existingBookingChange", "orderStatus", "correction", "recallProcess", "recall", "salesLocation"].some(k => typeof (v as unknown as Record<string,unknown>)[k] !== "boolean")
    || ![null, "product", "service"].includes(v.referenceKind) || v.referenceIndex !== null && (!Number.isInteger(v.referenceIndex) || v.referenceIndex < 1 || v.referenceIndex > 10)
    || v.statusReference !== null && (typeof v.statusReference !== "string" || v.statusReference.length > 36)
    || typeof v.positiveEntityText !== "string" || v.positiveEntityText.length > message.length || v.positiveEntityText && !message.includes(v.positiveEntityText)
    || typeof v.evidence !== "string" || !v.evidence.trim() || !message.includes(v.evidence)
    || !Array.isArray(v.facts) || v.facts.length > 32 || !Array.isArray(v.recallKeys) || v.recallKeys.length > 32
    || !Array.isArray(v.requestedFields) || v.requestedFields.length > 32) return null;
  if (!Array.isArray(v.requestedProcesses) || v.requestedProcesses.length > 4 || v.requestedProcesses.some(k=>!processKinds.includes(k)) || new Set(v.requestedProcesses).size !== v.requestedProcesses.length) return null;
  if (typeof v.unresolvedInput !== "boolean" || !Array.isArray(v.unresolvedFields) || v.unresolvedFields.length > 32
    || v.unresolvedFields.some(f=>!f || Object.keys(f).length!==2 || !fields.includes(f.key) || !["invalid","ambiguous"].includes(f.reason))
    || new Set(v.unresolvedFields.map(f=>f.key)).size !== v.unresolvedFields.length
    || v.unresolvedFields.some(f=>v.facts.some(value=>value.key===f.key))) return null;
  if ([...v.recallKeys,...v.requestedFields].some(k => typeof k !== "string" || !fields.includes(k))) return null;
  if (v.facts.some(f => !f || Object.keys(f).some(k => !["key","value","evidence"].includes(k)) || !fields.includes(f.key)
    || typeof f.value !== "string" || !f.value.trim() || f.value.length > 2000 || typeof f.evidence !== "string" || !f.evidence.trim()
    || !message.includes(f.evidence) || !f.evidence.includes(f.value))) return null;
  const canonicalKey = (key: string) => ["customer_name","customer_phone","customer_email","customer_city","customer_address"].includes(key) ? key.slice(9) : key;
  const allKeys = [...v.facts, ...v.unresolvedFields].map(f=>canonicalKey(f.key));
  if (new Set(allKeys).size !== allKeys.length) return null;
  return v;
}
