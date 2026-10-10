import type { BookingDraft } from "@/lib/calendar/agent";
import { emptyState, type ConversationStatePayload } from "./engine";
import { migrateContext, type SharedContext } from "./context";

export type ProcessKind = "order" | "booking";
export type ConversationRouting = {
  process: ProcessKind | "information" | "support" | "clarify";
  action: "continue" | "start" | "resume" | "answer" | "clarify" | "correct";
  reason: string;
  source: "rules" | "ai";
  reusedFields: string[];
  missingFields: string[];
  suspended?: ProcessKind;
  resumed?: ProcessKind;
};
export type OrderTaskSnapshot = Pick<ConversationStatePayload,
  "product_id" | "product_type_id" | "step_key" | "fields" | "visual" | "completedVisual" |
  "revisitStep" | "unorderedWorkflow" | "orderWorkflowSnapshot" | "linearSnapshot"> & {
    order: SharedContext["order"];
    execution: SharedContext["execution"];
  };
export type ConversationProcesses = {
  active: ProcessKind | null;
  /** Bare confirmations belong to the most recent process prompt, never an older prompt. */
  promptOwner?: ProcessKind | null;
  order?: { id: string; status: "active" | "suspended" | "completed"; snapshot: OrderTaskSnapshot };
  booking?: { id: string; status: "active" | "suspended" | "completed"; draft?: BookingDraft; versionId?: string; visual?: ConversationStatePayload["visual"] };
  service?: { id: string; status: "active" | "suspended" | "completed"; promptCurrent?: boolean; versionId: string; visual: NonNullable<ConversationStatePayload["visual"]>; fields: ConversationStatePayload["fields"]; order: SharedContext["order"] };
  auxiliary?: { process: "information" | "support"; visual: NonNullable<ConversationStatePayload["visual"]> };
  pendingChoice?: { kind: "process" | "replace"; process?: ProcessKind; message: string };
  lastDecision?: ConversationRouting;
};

export function snapshotOrder(state: ConversationStatePayload): OrderTaskSnapshot {
  const fields = structuredClone(state.fields);
  delete fields.booking;
  return structuredClone({
    product_id: state.product_id, product_type_id: state.product_type_id, step_key: state.step_key,
    fields, visual: state.visual, completedVisual: state.completedVisual, revisitStep: state.revisitStep,
    unorderedWorkflow: state.unorderedWorkflow, orderWorkflowSnapshot: state.orderWorkflowSnapshot,
    linearSnapshot: state.linearSnapshot, order: state.context?.order ?? {}, execution: state.context?.execution ?? {},
  });
}

export function restoreOrder(state: ConversationStatePayload): ConversationStatePayload {
  const snapshot = state.processes?.order?.snapshot;
  if (!snapshot) return state;
  const { order, execution, ...legacy } = structuredClone(snapshot);
  return { ...state, ...legacy, context: { profile: structuredClone(state.context!.profile), order, execution } };
}

/** Upgrade the adapter state without rewriting pinned workflow versions or guessing identity. */
export function migrateConversationProcesses(input: ConversationStatePayload | null | undefined, id: () => string): ConversationStatePayload {
  const state = migrateContext(input);
  if (!state.processes) {
    const booking = state.fields.booking as BookingDraft | undefined;
    const hasOrder = Boolean(state.product_id || (state.visual && !["completed", "handoff"].includes(state.visual.status)));
    state.processes = { active: booking ? "booking" : hasOrder ? "order" : null };
    if (hasOrder) state.processes.order = { id: id(), status: booking ? "suspended" : state.step_key === "order_ready" ? "completed" : "active", snapshot: snapshotOrder(state) };
    if (booking && typeof booking.nonce === "string") state.processes.booking = { id: booking.nonce, draft: structuredClone(booking), status: "active" };
    state.processes.promptOwner = state.processes.active;
  }
  state.schemaVersion = 3;
  return state;
}

export function bookingAdapterState(state: ConversationStatePayload) {
  const next = migrateContext(emptyState());
  next.schemaVersion = 3;
  next.context!.profile = structuredClone(state.context!.profile);
  next.customer = structuredClone(state.customer);
  next.recentMessages = state.recentMessages;
  next.processes = state.processes;
  next.visual = state.processes?.booking?.visual;
  if (state.processes?.booking?.draft) next.fields.booking = structuredClone(state.processes.booking.draft);
  return next;
}
