export type { ConversationStatePayload, WorkflowStepDef } from "./engine";
import type { ConversationStatePayload } from "./engine";

/** Browser-safe state construction and catalog normalization; no semantic interpretation. */
export function emptyState(): ConversationStatePayload {
  return {
    product_id: null,
    product_type_id: null,
    step_key: "choose_product",
    fields: {},
    customer: { name: null, phone: null, city: null, address: null },
  };
}

/** Fold Albanian/Latin text for loose product matching. */
export function foldText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .trim();
}
