import type { ConversationStatePayload } from "./engine";
import type { VisualRunState, VisualVersion } from "./visual/types";

type Selection = {
  state?: ConversationStatePayload | null;
  visualPreview?: VisualVersion;
  entityVersion?: VisualVersion | null;
  informationRequest?: boolean;
  supportRequest?: boolean;
  bookingRequest?: boolean;
  orderStatusRequest?: boolean;
};
export type WorkflowExecutionPolicy =
  | { kind: "legacy_continuation" }
  | { kind: "visual"; previous?: VisualRunState; selected?: VisualVersion | null; pinnedId?: string };

/** One authority decision for the visual runtime and compatibility adapters.
 * New processes use the business visual workflow. Existing linear orders keep
 * their persisted definition until completion; preview never changes that state. */
export function workflowExecutionPolicy(input: Selection): WorkflowExecutionPolicy {
  let previous = input.state?.visual;
  if (previous?.status === "completed" && input.entityVersion !== undefined && input.entityVersion?.id !== previous.versionId)
    previous = undefined;
  const interrupting = input.informationRequest || input.supportRequest || input.bookingRequest || input.orderStatusRequest;
  if (!input.visualPreview && !interrupting && !previous && input.state?.product_id && input.state.step_key !== "order_ready")
    return { kind: "legacy_continuation" };
  return { kind: "visual", previous, selected: input.visualPreview ?? input.entityVersion, pinnedId: previous?.versionId };
}

export const workflowPlanningContract = `The canonical model for new business processes is the existing visual business workflow, shared with the manual editor. Use workflow_* for new processes and product/service branches. Linear/orderflow definitions are compatibility formats: use them only to inspect or maintain explicitly selected existing definitions or an explicitly requested legacy library. Do not create a parallel definition as a shortcut. Configure required facts and business conditions; reuse facts already supplied rather than forcing a question per field. Informational answers do not need a custom workflow. A draft is not published, customer confirmation is not execution, and order preparation is not order dispatch. Do not ask the owner to activate standard modules. Readiness means actual data, business authorization and integrations, not menu visibility.`;
