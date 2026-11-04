import type { ConversationStatePayload, WorkflowStepDef } from "./engine";
import { missingProfile } from "./context";
import type { ProcessCommunication } from "@/lib/conversations/process-communication";

/** Translate a server-selected linear cursor to the same communication contract
 * as graph collection. Confirmation, navigation and terminal replies stay sealed. */
export function linearCollectionCommunication(state: ConversationStatePayload, steps: WorkflowStepDef[], fallback: string): ProcessCommunication | undefined {
  const step = steps.find(s => s.key === state.step_key);
  if (!step || step.kind === "confirm" || ["order_confirm", "order_ready"].includes(state.step_key ?? "")
    || state.context?.execution.profileConfirmation === "pending") return;
  const invalid = state.context?.execution.invalidFields?.[0];
  const profile = step.kind === "customer" ? missingProfile(state)[0] : undefined;
  const field = invalid ?? (profile ? `customer_${profile}` : step.fieldKey ?? step.key);
  const definition = steps.find(s => (s.fieldKey ?? s.key) === field) ?? step;
  const format = field === "customer_phone" ? "phone" : field === "customer_email" ? "email"
    : definition.kind === "photo" ? "photo" : definition.fieldType ?? "text";
  if (step.kind === "customer" && !profile && !invalid) return;
  // Keep the configured fallback verbatim. Its validation wording is already
  // included by the linear adapter; the model receives invalid separately.
  return { kind: "collect", field, label: definition.label ?? field, format,
    guidance: fallback, fallback, invalid: Boolean(invalid) };
}
