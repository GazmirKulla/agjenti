import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { currentProcessOwner, type ConversationRouting, type LocalProcessKind } from "@/lib/workflows/conversation-processes";
import { type GuidanceTarget } from "@/lib/workflows/guidance";
import { validValue, type FieldType } from "@/lib/workflows/context";
import { positiveEntityText } from "@/lib/products/entity-bridge";

export type TurnEntity =
  | { status: "none" }
  | { status: "resolved"; kind: "product" | "service"; id: string }
  | { status: "unresolved"; kind: "product" | "service" | "unknown" };
export type CollectionTarget = { key: string; type: FieldType; options?: string[] };
export type TurnIntent = "information" | "order" | "booking" | "service" | "support" | "undetermined";
/** Ephemeral server-owned decision. Never persisted as another state authority,
 * accepted from an HTTP payload, or used as authorization/confirmation evidence.
 * `workflow` delegates graph/linear selection to the existing adapter. */
type DecisionContext = {
  intent: TurnIntent;
  entity: TurnEntity;
  process: LocalProcessKind | null;
  promptOwner: LocalProcessKind | null;
  versionId: string | null;
  executor: "coordinator" | "workflow" | "legacy_information" | "booking";
};
export type TurnDecision = DecisionContext & (
  | { kind: "information" | "entity_reference" | "new_process" | "continuation" | "interruption" | "resume" | "correction" | "handoff" | "cancel" }
  | { kind: "field_answer"; field: CollectionTarget }
  | { kind: "clarification"; reason: "entity" | "process" | "stale_choice" }
  | { kind: "blocked"; reason: "staff_owned" | "capability" }
);

/** Intent, not entity matching. An explicit desire in a question remains an
 * action request; a how-to/price question alone never grants one. */
export function turnIntent(message: string): TurnIntent { return messageUnderstanding(message).intent; }

/** Only a declared typed literal or exact choice may override punctuation.
 * Free prose, confirmations and entity references are never normalized here. */
export function collectionInput(message: string, field?: CollectionTarget): string | undefined {
  if (!field || turnIntent(message) !== "undetermined") return;
  const value = message.trim().replace(/[!?]+$/, "").trim();
  if (field.options?.length) return field.options.find(option => foldText(option) === foldText(value));
  if (field.type !== "text" && field.type !== "photo" && validValue(value, field.type)) return value;
}

export function decisionForTurn(input: {
  message: string; state?: ConversationStatePayload | null; routing?: ConversationRouting;
  executor: DecisionContext["executor"]; entity?: TurnEntity; field?: CollectionTarget;
  process?: LocalProcessKind; intent?: TurnIntent; versionId?: string | null;
}): TurnDecision {
  const { state, routing } = input;
  const owner = state && currentProcessOwner(state) || state?.processes?.active || null;
  const process = input.process ?? routing?.resumed ?? (routing?.process === "order" || routing?.process === "booking" ? routing.process : owner);
  const context: DecisionContext = {
    intent: input.intent ?? turnIntent(input.message), entity: input.entity ?? { status: "none" }, process,
    promptOwner: state && currentProcessOwner(state) || null,
    versionId: input.versionId ?? state?.visual?.versionId ?? state?.context?.execution.linear?.versionId ?? null,
    executor: input.executor,
  };
  if (state?.staffHandoff || state?.visual?.status === "handoff" && !state.visual.advisory) return { ...context, kind: "blocked", reason: "staff_owned" };
  if (routing?.action === "clarify" || routing?.process === "clarify") return { ...context, kind: "clarification", reason: context.entity.status === "unresolved" ? "entity" : "process" };
  if (routing?.reason === "clarification_stale") return { ...context, kind: "clarification", reason: "stale_choice" };
  if (routing?.reason === "clarification_cancel" || messageUnderstanding(input.message).navigation === "cancel") return { ...context, kind: "cancel" };
  if (routing?.action === "resume") return { ...context, kind: "resume" };
  if (context.intent === "support" || routing?.process === "support") return { ...context, kind: "handoff" };
  const correction = positiveEntityText(input.message);
  if (correction.correction && correction.text || messageUnderstanding(input.message).correction) return { ...context, kind: "correction" };
  if (input.process && context.intent !== "information") {
    if (routing?.action === "start") return { ...context, kind: "new_process" };
    if (input.field && context.intent === "undetermined") return { ...context, kind: "field_answer", field: input.field };
    if (routing?.action === "continue") return { ...context, kind: "continuation" };
  }
  if (routing?.process === "information" || context.intent === "information") return { ...context, kind: routing?.suspended || owner ? "interruption" : context.entity.status !== "none" ? "entity_reference" : "information" };
  if (input.field && context.intent === "undetermined") return { ...context, kind: "field_answer", field: input.field };
  if (routing?.action === "start" || !owner && (context.intent === "order" || context.intent === "booking" || context.intent === "service")) return { ...context, kind: "new_process" };
  if (context.entity.status !== "none" && !owner && context.intent === "undetermined") return { ...context, kind: "entity_reference" };
  return { ...context, kind: owner ? "continuation" : "information" };
}

/** Compatibility bridge: navigation/correction still needs graph-local targets,
 * but a field answer already owned by the coordinator must not be rerouted. */
export function decidedFieldGuidance(decision?: TurnDecision, routes?: GuidanceTarget[]) {
  if (!decision) return;
  if (["field_answer", "continuation", "resume"].includes(decision.kind)) return { action: "continue" as const, target: null, source: "rules" as const };
  if (decision.kind === "new_process" && routes) {
    const kind = decision.process === "order" ? "product" : decision.process === "booking" ? "booking" : undefined;
    const entries = kind ? routes.filter(route => route.kind === kind) : [];
    if (entries.length) return entries.length === 1 ? { action: "route" as const, target: entries[0].id, source: "rules" as const }
      : { action: "clarify" as const, target: null, source: "rules" as const };
  }
}

export function informationalDecision(decision?: TurnDecision) {
  return Boolean(decision && ["information", "entity_reference", "interruption"].includes(decision.kind));
}
