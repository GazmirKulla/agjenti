import type { TimedTraceEvent } from "@/lib/conversations/trace";

/** Only runtime observations for this turn; never infer execution from a saved cursor. */
export function workflowEvidence(trace: TimedTraceEvent[]) {
  return trace.filter(event => event.stage === "workflow"
    && (event.label === "Visual workflow executed" || event.label === "Workflow resolved")
    && event.status !== "error" && event.status !== "skipped");
}

export function latestWorkflowObservation(trace: TimedTraceEvent[]) {
  return workflowEvidence(trace).at(-1)?.data ?? {};
}
