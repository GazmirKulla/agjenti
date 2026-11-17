/** Business preferences only. None of these settings authorize an operation or
 * change a required field, approval, catalog fact or staff ownership. */
export type CommunicationPolicy = {
  version: 1;
  language: "customer" | "sq" | "en";
  tone: "warm" | "neutral" | "formal";
  length: "concise" | "balanced";
  questions: "when_needed" | "on_request";
  emoji: "none" | "light";
  /** After a reply that presents catalog products, the server also sends their photos (when they have one). */
  productPhotos: "send" | "off";
  /** How much a reply says about a catalog product it presents: what helps the customer decide, or only what was asked. */
  productDetails: "helpful" | "essentials";
};
export const defaultCommunicationPolicy: CommunicationPolicy = {
  version: 1, language: "customer", tone: "warm", length: "concise", questions: "when_needed", emoji: "light", productPhotos: "send", productDetails: "helpful",
};
const choices = {
  language: ["customer", "sq", "en"], tone: ["warm", "neutral", "formal"],
  length: ["concise", "balanced"], questions: ["when_needed", "on_request"], emoji: ["none", "light"],
  productPhotos: ["send", "off"], productDetails: ["helpful", "essentials"],
} as const;
export function parseCommunicationPolicy(value: unknown): CommunicationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
  // Policies saved before the product preferences existed keep their defaults.
  const p: Record<string, unknown> = { productPhotos: defaultCommunicationPolicy.productPhotos, productDetails: defaultCommunicationPolicy.productDetails, ...(value as Record<string, unknown>) };
  if (p.version !== 1 || Object.keys(p).some(key => key !== "version" && !Object.hasOwn(choices, key))
    || Object.entries(choices).some(([key, allowed]) => !(allowed as readonly unknown[]).includes(p[key])))
    throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
  return { version: 1, language: p.language, tone: p.tone, length: p.length, questions: p.questions, emoji: p.emoji, productPhotos: p.productPhotos, productDetails: p.productDetails } as CommunicationPolicy;
}

/** Explicit precedence: platform/evidence > process > communication settings >
 * free-form wording preferences > illustrative training examples. */
export function communicationPolicyInstructions(policy: CommunicationPolicy = defaultCommunicationPolicy) {
  const language = policy.language === "customer" ? "Use the customer's language, resolving short replies from recent conversation." : `Write in ${policy.language === "sq" ? "Albanian" : "English"}.`;
  return `\nCommunication policy v1 (business preferences, never authorization): ${JSON.stringify(policy)}
${language} Use a ${policy.tone} tone and ${policy.length} answers. ${policy.emoji === "none" ? "Do not use emoji." : "Use at most one emoji when appropriate; omit it in errors and confirmations."}
${policy.productDetails === "helpful"
    ? "When you present a catalog product, also say in your own words the few supplied details that help this customer decide for their request, such as size, material, the variants and their prices, or a reserved or rented status; this applies with concise answers too. Use only the supplied catalog data, never invent a detail, and do not list every field.\n"
    : "When you present a catalog product, say only what the customer asked about it; give its other details when the customer asks for them.\n"}${policy.productPhotos === "send" ? "The server sends the stored photo of each catalog product you present with a [[product:id]] slot after your reply, when it has one; never write image links and never promise or deny photos yourself.\n" : ""}${policy.questions === "on_request" ? "Do not ask optional qualification questions; question must be null. Required process questions remain controlled by the server." : "Ask at most one optional question only when it helps the current request; do not turn every answer into qualification."}
Answer first and ask only for what you need. A greeting never starts registration. Apply these rules silently: do not narrate the conversation classification, JSON contract or internal consent rules. Explain an action's limits only when relevant to the customer's actual request. These preferences override conflicting wording examples, but never platform boundaries, verified facts, required process fields or confirmations.`;
}
