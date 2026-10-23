import { foldText } from "@/lib/workflows/engine";
import type { ConversationStatePayload } from "@/lib/workflows/engine";

export type CustomerFactKey = "name" | "phone" | "email" | "city" | "address" | "instagram_handle" | "business_type" | "stated_needs";
export type CustomerFactReference = {
  keys: CustomerFactKey[]; relation?: "sales_location";
  /** Read-only retrieval request, not permission to start/resume a process. */
  recall?: true;
  process?: true;
};
const tokens = (text: string) => foldText(text).split(/[^a-z0-9_]+/).filter(Boolean);

/** A bounded fact reference, not a process/intent classifier. Only the customer's
 * own question selects facts. Prior USER turns can resolve a short follow-up;
 * assistant prose never supplies identity or values. */
export function customerFactReference(message: string, state?: ConversationStatePayload): CustomerFactReference | undefined {
  const words = tokens(message), has = (...values: string[]) => values.some(v => words.includes(v));
  const text = foldText(message);
  // Imperatives are retrieval too. Do not require punctuation or a possessive
  // pronoun, and do not interpret a request about the tenant/staff as personal.
  const recall = /^(?:(?:te lutem|ju lutem|please)\s+)?(?:(?:me\s+)?(?:ri)?kujto\b|(?:me\s+)?permblidh\b|remind me\b|recap\b|summarize\b)/.test(text.trim())
    || /^(?:me trego|show me)\b/.test(text.trim()) && /\b(?:dhashe|dhene|thene|treguar|provided|told)\b/.test(text);
  const foreign = /\b(?:yt|juaj|tuaj|your|staff|stafi\w*|pronari\w*)\b|\b(?:i|e|te) (?:biznesit|dyqanit|kompanise)\b/.test(text);
  const own = has("im", "ime", "tim", "time", "mia", "mua", "une", "quhem", "dhashe", "dhene", "thene", "kam", "marr", "my", "mine") || recall && !foreign;
  const process = !foreign && /\b(?:kerkes\w*|porosi\w*|sherbim\w*|rezerv\w*|takim\w*|request|order|service|booking|appointment)\b/.test(text)
    && (recall || /\b(?:cfare|cilat|what)\b/.test(text) && /\b(?:dhene|dhashe|treguar|preferenc\w*|dime|dim|kete|aktual\w*|provided|preferences|current)\b/.test(text));
  const flags = { ...(recall ? { recall: true as const } : {}), ...(process ? { process: true as const } : {}) };
  const broad = /cfare te kam thene|what (?:have i|did i) (?:tell|provide)|te dhenat e mia|my (?:details|information)/.test(foldText(message));
  const businessSummary = !foreign && /(?:kam (?:treguar|thene)|i (?:told|said))/.test(text) && /\b(?:biznes\w*|business)\b/.test(text);
  if (businessSummary) return { keys: ["business_type", "stated_needs"], recall: true };
  if (broad && !process && !foreign) return { keys: ["name", "instagram_handle", "business_type", "stated_needs"], ...flags };
  const sales = words.some(w => /^(shes|shet|shisja|shitje|sell|selling)$/.test(w));
  const keys: CustomerFactKey[] = [];
  if (own && !foreign) {
    if (has("quhem", "name") || words.some(w => w.startsWith("emr"))) keys.push("name");
    if (has("phone", "numri") || words.some(w => w.startsWith("telefon"))) keys.push("phone");
    if (has("email")) keys.push("email");
    if (has("city") || words.some(w => w.startsWith("qytet"))) keys.push("city");
    if (has("address") || words.some(w => w.startsWith("adres"))) keys.push("address");
    if (words.some(w => w.startsWith("instagram"))) keys.push("instagram_handle");
    if (has("business") || words.some(w => w.startsWith("biznes")) || sales) keys.push("business_type");
    if (has("questions", "needs") || words.some(w => /^(pyetje|nevoj)/.test(w))) keys.push("stated_needs");
  }
  // Albanian first-person verb carries its subject even without 'unë'.
  if (has("shes", "shisja") && !keys.includes("business_type")) keys.push("business_type");
  if (sales && has("ku", "where") && keys.includes("business_type")) return { keys: [...keys, "instagram_handle"], relation: "sales_location" };
  if (keys.length || process || recall && !foreign) return { keys: [...new Set(keys)], ...flags };
  if (state && has("dhashe", "thene", "provided") && has("fillim", "pare", "earlier")) {
    const prior = state.recentMessages?.filter(m => m.role === "user").slice(-2).reverse();
    for (const turn of prior ?? []) { const reference = customerFactReference(turn.content); if (reference) return reference; }
  }
  if (state && /^(?:po )?(?:ku|where)[?!.\s]*$/.test(foldText(message).trim())) {
    const prior = state.recentMessages?.filter(m => m.role === "user").at(-1);
    const reference = prior && customerFactReference(prior.content);
    if (reference?.keys.includes("business_type")) return { keys: ["business_type", "instagram_handle"], relation: "sales_location" };
  }
  return undefined;
}
