import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import { type Fact } from "./context";
import { type ConversationStatePayload } from "./state";

/** Conversation-local only. Never hydrate from / copy to conversation_profiles,
 * never use as business configuration, entity identity or execution permission. */
export const customerDeclaredKeys = ["instagram_handle", "business_type", "stated_needs"] as const;
export type CustomerDeclaredKey = typeof customerDeclaredKeys[number];
export type CustomerDeclaredFacts = Partial<Record<CustomerDeclaredKey, Fact>>;

export function validDeclaredValue(key: CustomerDeclaredKey, value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\n\r\x00-\x1f]/.test(value)) return false;
  return key !== "instagram_handle" || /^@?[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?$/.test(value);
}

/** Explicit own statements only, not free-form summaries or LLM-inferred facts.
 * Commas are retained in stated needs; newline/semicolon delimit statements. */
export function extractCustomerDeclaredFacts(state: ConversationStatePayload, message: string) {
  // A paused process is not staff ownership or a prohibition on explicit facts.
  // These declarations never resume that process or populate its fields.
  if (state.staffHandoff || state.visual?.status === "handoff") return 0;
  let count = 0;
  for (const candidate of messageUnderstanding(message).facts) {
    if (!customerDeclaredKeys.includes(candidate.key as CustomerDeclaredKey) || !validDeclaredValue(candidate.key as CustomerDeclaredKey, candidate.value)) continue;
    state.customerDeclaredFacts ??= {};
    state.customerDeclaredFacts[candidate.key as CustomerDeclaredKey] = { value: candidate.value, type: "text", source: "customer_declaration", validated: true };
    count++;
  }
  return count;
}
