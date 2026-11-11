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

