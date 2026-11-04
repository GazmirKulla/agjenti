import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import type { ConversationStatePayload } from "@/lib/workflows/engine";

export type CustomerFactKey = "name" | "phone" | "email" | "city" | "address" | "instagram_handle" | "business_type" | "stated_needs";
export type CustomerFactReference = {
  keys: CustomerFactKey[]; relation?: "sales_location";
  /** Read-only retrieval request, not permission to start/resume a process. */
  recall?: true;
  process?: true;
};
/** Personal disclosure is selected by validated meaning, never possessive words. */
export function customerFactReference(message: string, _state?: ConversationStatePayload): CustomerFactReference | undefined {
  const m = messageUnderstanding(message);
  if (!m.recall && !m.recallProcess) return;
  const allowed: CustomerFactKey[] = ["name", "phone", "email", "city", "address", "instagram_handle", "business_type", "stated_needs"];
  return { keys: m.recallKeys.filter((key): key is CustomerFactKey => allowed.includes(key as CustomerFactKey)),
    ...(m.recall ? { recall: true } : {}), ...(m.recallProcess ? { process: true } : {}), ...(m.salesLocation ? { relation: "sales_location" } : {}) };
}
