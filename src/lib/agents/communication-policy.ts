/** Business preferences only. None of these settings authorize an operation or
 * change a required field, approval, catalog fact or staff ownership. */
export type CommunicationPolicy = {
  version: 1;
  language: "customer" | "sq" | "en";
  tone: "warm" | "neutral" | "formal";
  length: "concise" | "balanced";
  questions: "when_needed" | "on_request";
  emoji: "none" | "light";
};
export const defaultCommunicationPolicy: CommunicationPolicy = {
  version: 1, language: "customer", tone: "warm", length: "concise", questions: "when_needed", emoji: "light",
};
const choices = {
  language: ["customer", "sq", "en"], tone: ["warm", "neutral", "formal"],
  length: ["concise", "balanced"], questions: ["when_needed", "on_request"], emoji: ["none", "light"],
} as const;
export function parseCommunicationPolicy(value: unknown): CommunicationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(key => key !== "version" && !Object.hasOwn(choices, key))
    || Object.entries(choices).some(([key, allowed]) => !(allowed as readonly unknown[]).includes(p[key])))
    throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
  return { version: 1, language: p.language, tone: p.tone, length: p.length, questions: p.questions, emoji: p.emoji } as CommunicationPolicy;
}

/** Explicit precedence: platform/evidence > process > communication settings >
 * free-form wording preferences > illustrative training examples. */
export function communicationPolicyInstructions(policy: CommunicationPolicy = defaultCommunicationPolicy) {
  const language = policy.language === "customer" ? "Use the customer's language, resolving short replies from recent conversation." : `Write in ${policy.language === "sq" ? "Albanian" : "English"}.`;
  return `\nCommunication policy v1 (business preferences, never authorization): ${JSON.stringify(policy)}
${language} Use a ${policy.tone} tone and ${policy.length} answers. ${policy.emoji === "none" ? "Do not use emoji." : "Use at most one emoji when appropriate; omit it in errors and confirmations."}
${policy.questions === "on_request" ? "Do not ask optional qualification questions; question must be null. Required process questions remain controlled by the server." : "Ask at most one optional question only when it helps the current request; do not turn every answer into qualification."}
Answer first and ask only for what you need. A greeting never starts registration. Apply these rules silently: do not narrate the conversation classification, JSON contract or internal consent rules. Explain an action's limits only when relevant to the customer's actual request. These preferences override conflicting wording examples, but never platform boundaries, verified facts, required process fields or confirmations.`;
}
