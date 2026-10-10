import type { VisualFlow, VisualFlowKind } from "@/lib/workflows/visual/types";

/** A category is not an identity: never silently pick the first of several flows. */
export function workflowHubSelection(flows: VisualFlow[], kind: VisualFlowKind):
  | { action: "create"; kind: VisualFlowKind }
  | { action: "open"; flowId: string }
  | { action: "choose"; flows: VisualFlow[] } {
  const matches = flows.filter(flow => flow.kind === kind);
  if (!matches.length) return { action: "create", kind };
  if (matches.length === 1) return { action: "open", flowId: matches[0].id };
  return { action: "choose", flows: matches };
}
