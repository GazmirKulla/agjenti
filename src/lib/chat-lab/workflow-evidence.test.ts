import { expect, it } from "vitest";
import type { TimedTraceEvent } from "@/lib/conversations/trace";
import { workflowEvidence, latestWorkflowObservation } from "./workflow-evidence";
const event = (label: string, versionId: string): TimedTraceEvent => ({ stage: "workflow", label, elapsedMs: 10, data: { versionId } });
it("does not turn routing or a carried conversation version into execution evidence", () => {
  const trace = [event("Conversation process selected", "old-version"), event("Conversation coordinator completed", "old-version")];
  expect(workflowEvidence(trace)).toEqual([]);
  expect(latestWorkflowObservation(trace)).toEqual({});
});
it("retains every observation in order, including different versions in one composed reply", () => {
  const trace = [event("Visual workflow executed", "pinned-version"), event("Workflow resolved", "linear-version"), event("Conversation coordinator completed", "other-version")];
  expect(workflowEvidence(trace)).toEqual(trace.slice(0, 2));
  expect(latestWorkflowObservation(trace)).toEqual({ versionId: "linear-version" });
});
it("does not present failed or skipped workflow events as successful execution", () => {
  expect(workflowEvidence([{ ...event("Visual workflow executed", "failed"), status: "error" }, { ...event("Workflow resolved", "skipped"), status: "skipped" }])).toEqual([]);
});
