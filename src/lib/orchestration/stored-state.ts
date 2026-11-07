import { emptyState, type ConversationStatePayload } from "@/lib/workflows/state";
import { TransitionError, type Snapshot } from "./contracts";

/** Database stores the process snapshot directly. The outer object is only an API projection. */
export function readStoredConversationState(value: unknown, scope: { businessId: string; conversationId: string; revision?: number }): ConversationStatePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TransitionError("invalid_stored_state");
  const state = value as Record<string, unknown>;
  if (state.schemaVersion === 4) {
    const snapshot = state as unknown as Snapshot;
    if (snapshot.mode !== "live" || snapshot.businessId !== scope.businessId || snapshot.conversationId !== scope.conversationId
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || scope.revision !== undefined && snapshot.revision !== scope.revision
      || !snapshot.instances || typeof snapshot.instances !== "object" || Array.isArray(snapshot.instances)
      || !snapshot.offers || typeof snapshot.offers !== "object" || Array.isArray(snapshot.offers)
      || !(snapshot.focusId === null || typeof snapshot.focusId === "string" && Object.hasOwn(snapshot.instances, snapshot.focusId))) throw new TransitionError("invalid_stored_process_state");
    return { ...emptyState(), runtime: structuredClone(snapshot), recentMessages: snapshot.history ?? [], step_key: snapshot.focusId ? snapshot.instances[snapshot.focusId].stepId : null };
  }
  if (!Object.keys(state).length) return emptyState();
  throw new TransitionError("unsupported_stored_state");
}
