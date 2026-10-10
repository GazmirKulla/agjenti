import type { AssistantUIContext } from "@/lib/business-assistant/context";

export type RequestMessage = { role: "user" | "assistant"; content: string };
export type WorkflowRequestPin = { scope: string; context: AssistantUIContext; history: RequestMessage[] };
type ContinuationResult = { clarifying?: boolean; choices?: string[]; token?: string; workflow?: { proposed?: unknown }; editableFlow?: boolean; linear?: unknown; saved?: boolean };

/** Selecting another card is navigation, not an answer that retargets a pending edit. */
export function pinnedWorkflowContext(current: AssistantUIContext, pin?: WorkflowRequestPin | null): AssistantUIContext {
  if (!pin || current.page !== "workflows" || !pin.context.workflowSelection) return structuredClone(current);
  return {
    ...structuredClone(pin.context),
    workflowSelection: { ...pin.context.workflowSelection, dirty: pin.context.workflowSelection.dirty || current.workflowSelection?.dirty === true },
  };
}

export function continuesWorkflowRequest(result: ContinuationResult) {
  return !result.saved && Boolean(result.clarifying || result.choices?.length || (result.token && (result.workflow?.proposed || result.editableFlow || result.linear)));
}

/** Preserve earlier clarification answers within the API's eight-message budget. */
export function workflowRequestHistory(history: RequestMessage[]): RequestMessage[] {
  if (history.length <= 8) return history;
  const earlier = history.slice(0, -6).map(message => `${message.role === "user" ? "Përdoruesi" : "Agjenti"}: ${message.content}`).join("\n\n");
  if (earlier.length > 11900) throw new Error("Kërkesa përmban shumë sqarime. Ruaj propozimin ose nis një kërkesë të re.");
  return [{ role: "user", content: `Sqarimet e kësaj kërkese, sipas radhës:\n${earlier}` }, ...history.slice(-6)];
}
