import type { BookingDraft } from "@/lib/calendar/agent";
import { emptyState, type ConversationStatePayload } from "./engine";
import { freshOrderReview, invalidateOrderReview, migrateContext, projectProfile, type SharedContext } from "./context";
import type { VisualVersion } from "./visual/types";

export type ProcessKind = "order" | "booking";
export type LocalProcessKind = ProcessKind | "service" | "actionFlow";
/** A navigation choice, never approval of an order, booking or external action. */
export type PendingClarification = {
  kind: "resume_process";
  expiresAt: number;
  target: { process: LocalProcessKind; id: string; versionId: string | null; cursor: string } | null;
};
export type ConversationRouting = {
  process: ProcessKind | "information" | "support" | "clarify";
  action: "continue" | "start" | "resume" | "answer" | "clarify" | "correct";
  reason: string;
  source: "rules" | "ai";
  reusedFields: string[];
  missingFields: string[];
  suspended?: LocalProcessKind;
  resumed?: LocalProcessKind;
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
  booking?: { id: string; status: "active" | "suspended" | "completed"; draft?: BookingDraft; versionId?: string; visual?: ConversationStatePayload["visual"]; order?: SharedContext["order"]; fields?: ConversationStatePayload["fields"] };
  service?: { id: string; status: "active" | "suspended" | "completed"; promptCurrent?: boolean; versionId: string; visual: NonNullable<ConversationStatePayload["visual"]>; fields: ConversationStatePayload["fields"]; order: SharedContext["order"] };
  actionFlow?: { id?: string; versionId: string; visual: NonNullable<ConversationStatePayload["visual"]>; promptCurrent: boolean; order?: SharedContext["order"]; fields?: ConversationStatePayload["fields"] };
  auxiliary?: { process: "information" | "support"; visual: NonNullable<ConversationStatePayload["visual"]>; order?: SharedContext["order"]; fields?: ConversationStatePayload["fields"] };
  pendingChoice?: { kind: "process" | "replace"; process?: ProcessKind; message: string; productId?: string };
  pendingClarification?: PendingClarification;
  /** Explicit information-only choice; a follow-up must not infer a purchase/reservation. */
  informationOnly?: boolean;
  lastDecision?: ConversationRouting;
};

/** Read the existing ownership markers in one place, including pre-C1 v3 snapshots. */
export function currentProcessOwner(state: ConversationStatePayload): LocalProcessKind | null {
  const p = state.processes;
  if (!p) return null;
  const action = p.actionFlow?.promptCurrent && p.actionFlow.visual.status === "waiting" && p.actionFlow.visual.awaiting;
  const service = p.service?.promptCurrent && p.service.status === "active" && p.service.visual.status === "waiting" && p.service.visual.awaiting;
  if (action && service) return null; // Conflicting historical prompts cannot authorize a short answer.
  if (action) return "actionFlow";
  if (service) return "service";
  return p.promptOwner && p[p.promptOwner]?.status === "active" ? p.promptOwner : null;
}

/** Suspend ownership, not business data. Each process keeps its own adapter snapshot. */
export function suspendProcesses(state: ConversationStatePayload, except?: LocalProcessKind) {
  const p = state.processes;
  if (!p) return;
  if (p.active === "order" && except !== "order" && p.order && state.context?.execution.factOwner === "order" && !p.auxiliary)
    p.order.snapshot = snapshotOrder(state);
  for (const kind of ["order", "booking"] as const)
    if (kind !== except && p[kind]?.status === "active") p[kind]!.status = "suspended";
  if (except !== "service" && p.service) {
    if (p.service.status === "active") p.service.status = "suspended";
    p.service.promptCurrent = false;
  }
  if (except !== "actionFlow" && p.actionFlow) p.actionFlow.promptCurrent = false;
  if (p.active !== except) p.active = null;
  if (p.promptOwner !== except) p.promptOwner = null;
}

export function snapshotOrder(state: ConversationStatePayload): OrderTaskSnapshot {
  const fields = structuredClone(state.fields);
  delete fields.booking;
  return structuredClone({
    product_id: state.product_id, product_type_id: state.product_type_id, step_key: state.step_key,
    fields, visual: state.visual, completedVisual: state.completedVisual, revisitStep: state.revisitStep,
    unorderedWorkflow: state.unorderedWorkflow, orderWorkflowSnapshot: state.orderWorkflowSnapshot,
    linearSnapshot: state.linearSnapshot, order: state.context?.order ?? {}, execution: { ...state.context?.execution, factOwner: "order" },
  });
}

export function restoreOrder(state: ConversationStatePayload, options: { resume?: boolean } = {}): ConversationStatePayload {
  const snapshot = state.processes?.order?.snapshot;
  if (!snapshot) return state;
  const { order, execution, ...legacy } = structuredClone(snapshot);
  delete legacy.completedVisual;
  // A saved cursor is not permission to replace live order facts or selection.
  // While another adapter owns context.order, its task snapshot owns the order.
  const live = state.context?.execution.factOwner === "order";
  const next = { ...state, ...legacy, customer: structuredClone(state.customer), context: { profile: structuredClone(state.context!.profile),
    order: structuredClone(live ? state.context!.order : order),
    execution: structuredClone(live ? state.context!.execution : execution) } };
  if (live) {
    next.product_id = state.product_id; next.product_type_id = state.product_type_id;
    next.orderWorkflowSnapshot = state.orderWorkflowSnapshot;
    next.linearSnapshot = structuredClone(state.linearSnapshot);
  }
  if (live && state.processes?.active === "order" && !state.processes.auxiliary) {
    next.step_key = state.step_key;
    next.visual = structuredClone(state.visual);
    next.revisitStep = state.revisitStep;
  }
  next.context.execution.factOwner = "order";
  for (const [key, fact] of Object.entries(next.context.order)) next.fields[key] = fact.type === "photo" ? true : fact.value;
  projectProfile(next);
  // Profile values on a historical cursor cannot overwrite the current profile.
  if (next.visual) {
    for (const [key, fact] of Object.entries(next.context.profile)) if (fact) next.visual.values[`customer_${key}`] = fact.value;
    for (const [key, fact] of Object.entries(next.context.order)) next.visual.values[key] = fact.value;
    if (options.resume) { delete next.visual.pendingConfirmation; delete next.visual.confirmedConfirmation; }
  }
  if (options.resume || !freshOrderReview(next, Boolean(next.context.execution.orderConfirmed))) {
    invalidateOrderReview(next.context.execution);
    if (next.step_key === "order_ready") next.step_key = "order_confirm";
  }
  return next;
}

type CursorOwner = LocalProcessKind | "information" | "support";

/** Classify only from the saved cursor and its immutable graph, never from node names. */
function cursorOwner(state: ConversationStatePayload, version?: VisualVersion | null): CursorOwner | undefined {
  const visual = state.visual;
  if (!visual) return;
  if (!version) {
    if (state.step_key === "booking_request" && bookingDraft(state.fields.booking)) return "booking";
    if (visual.binding?.entity.kind === "product") return "order";
    return;
  }
  if (version.id !== visual.versionId) throw new Error("workflow_version_mismatch");
  const graph = version.graph;
  const node = graph.nodes.find(node => node.id === visual.nodeId);
  if (!node) return;
  if (graph.version === 2) {
    const flows = graph.flows.filter(flow => visual.binding ? flow.id === visual.binding.flowId && flow.nodeIds.includes(node.id) : flow.nodeIds.includes(node.id));
    if (flows.length !== 1) return;
    const flow = flows[0];
    // A flow can embed an action of another process; the live action wins over its label.
    if (node.kind === "booking") return "booking";
    if (node.kind === "product") return "order";
    if (flow.kind !== "custom") return flow.kind;
    const kinds = new Set(graph.nodes.filter(node => flow.nodeIds.includes(node.id) && ["booking", "product"].includes(node.kind)).map(node => node.kind));
    if (kinds.size === 1) return kinds.has("booking") ? "booking" : "order";
    if (!kinds.size && visual.binding) return "service";
    if (!kinds.size && graph.nodes.some(node => flow.nodeIds.includes(node.id) && node.kind === "action")) return "actionFlow";
    return;
  }
  // V1 has no named flows: a current/visited action identifies its cursor. For
  // a collect before an action, classify only when all reachable actions agree.
  const actionOwner = (nodeId: string) => {
    const kind = graph.nodes.find(node => node.id === nodeId)?.kind;
    return kind === "booking" ? "booking" as const : kind === "product" ? "order" as const : undefined;
  };
  const known = actionOwner(node.id) ?? [...visual.visited].reverse().map(actionOwner).find(Boolean);
  if (known) return known;
  const pending = [node.id], seen = new Set<string>(), owners = new Set<ProcessKind>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const owner = actionOwner(current);
    if (owner) owners.add(owner);
    else pending.push(...graph.edges.filter(edge => edge.source === current).map(edge => edge.target));
  }
  return owners.size === 1 ? [...owners][0] : undefined;
}

function bookingDraft(value: unknown): BookingDraft | undefined {
  if (!value || typeof value !== "object") return;
  const draft = value as BookingDraft;
  return typeof draft.nonce === "string" && draft.nonce.trim() && ["collect", "confirm"].includes(draft.phase) ? draft : undefined;
}

/** Upgrade the adapter state without rewriting pinned workflow versions or guessing identity. */
export function migrateConversationProcesses(input: ConversationStatePayload | null | undefined, id: () => string, version?: VisualVersion | null): ConversationStatePayload {
  const state = migrateContext(input);
  if (!state.processes) {
    const booking = bookingDraft(state.fields.booking);
    const owner = cursorOwner(state, version);
    const visual = state.visual;
    const hasOrder = Boolean(state.product_id || state.context?.execution.linear || state.orderWorkflowSnapshot || owner === "order");
    state.processes = { active: null };
    if (hasOrder) {
      const snapshot = snapshotOrder(state);
      // A legacy state may contain an independent linear order plus a booking.
      // Restoring that order must never execute the booking graph as its cursor.
      if (owner !== "order") snapshot.visual = undefined;
      const completed = state.step_key === "order_ready" || owner === "order" && visual?.status === "completed";
      state.processes.order = { id: id(), status: completed ? "completed" : "suspended", snapshot };
    }
    if (booking || owner === "booking") {
      const cursor = owner === "booking" ? structuredClone(visual) : undefined;
      state.processes.booking = { id: booking?.nonce ?? id(), draft: booking ? structuredClone(booking) : undefined,
        status: cursor?.status === "completed" ? "completed" : "suspended", versionId: cursor?.versionId, visual: cursor };
    }
    if (owner === "service" && visual) {
      state.processes.service = { id: id(), versionId: visual.versionId, visual: structuredClone(visual),
        status: visual.status === "completed" ? "completed" : visual.status === "handoff" ? "suspended" : "active",
        promptCurrent: visual.status === "waiting" && visual.awaiting, fields: structuredClone(state.fields), order: structuredClone(state.context!.order) };
    }
    if (owner === "actionFlow" && visual && visual.status !== "completed") {
      state.processes.actionFlow = { id: id(), versionId: visual.versionId, visual: structuredClone(visual),
        promptCurrent: visual.status === "waiting" && visual.awaiting, fields: structuredClone(state.fields), order: structuredClone(state.context!.order) };
    }
    if ((owner === "information" || owner === "support") && visual && visual.status !== "completed") {
      state.processes.auxiliary = { process: owner, visual: structuredClone(visual) };
    }
    const terminal = visual?.status === "completed" || visual?.status === "handoff";
    const active = terminal ? null : owner === "booking" || owner === "order" ? owner
      : owner ? null : booking ? "booking" : hasOrder ? "order" : null;
    if (active && state.processes[active]?.status !== "completed") {
      state.processes.active = active;
      state.processes[active]!.status = "active";
    }
    state.processes.promptOwner = state.processes.active;
  }
  state.schemaVersion = 3;
  state.context!.execution.factOwner ??= state.processes.active === "booking" ? "booking"
    : state.processes.order ? "order" : state.processes.service ? "service" : "auxiliary";
  return state;
}

export function bookingAdapterState(state: ConversationStatePayload) {
  const next = migrateContext(emptyState());
  next.schemaVersion = 3;
  next.context!.profile = structuredClone(state.context!.profile);
  next.context!.execution.factOwner = "booking";
  next.context!.order = structuredClone(state.processes?.booking?.order ?? {});
  next.fields = structuredClone(state.processes?.booking?.fields ?? {});
  next.customer = structuredClone(state.customer);
  projectProfile(next);
  next.recentMessages = state.recentMessages;
  next.completedVisual = structuredClone(state.completedVisual);
  next.processes = state.processes;
  next.visual = structuredClone(state.processes?.booking?.visual);
  if (state.processes?.booking?.draft) next.fields.booking = structuredClone(state.processes.booking.draft);
  return next;
}
