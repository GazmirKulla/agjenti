import { expect, it } from "vitest";
import { addFlowTemplate } from "@/components/workflows/flow-templates";
import {
  starterVisualGraph,
  validateVisualGraph,
  normalizeVisualDraft,
} from "./model";
import { advanceVisualWorkflow } from "./runtime";
import { diffWorkflowGraphs } from "./diff";
const fixture = () =>
  addFlowTemplate(starterVisualGraph(), "business_provision", "registration")
    .graph;
it.each(["facts", "expired", "legacy"])("W2 prevents a %s-stale approval from executing a pending action", change => {
  const graph = fixture(), versionId = "v1";
  const prompt = advanceVisualWorkflow({ graph, versionId, state: { versionId, nodeId: "registration_confirm", status: "waiting", awaiting: true, visited: [], values: { biz_registration: "Shop", email_registration: "owner@example.com" } }, message: "", hasPhoto: false, intent: "unknown" });
  const approved = advanceVisualWorkflow({ graph, versionId, state: prompt.state, message: "Po", hasPhoto: false, intent: "unknown" });
  expect(approved.action.kind).toBe("action");
  if (change === "facts") approved.state.values.email_registration = "corrected@example.com";
  if (change === "expired") approved.state.confirmedConfirmation!.expiresAt = Date.now() - 1;
  if (change === "legacy") delete approved.state.confirmedConfirmation;
  const next = advanceVisualWorkflow({ graph, versionId, state: approved.state, message: "Po", hasPhoto: false, intent: "unknown" });
  expect(next.action.kind).toBe("prompt");
  expect(next.state.nodeId).toBe("registration_confirm");
});
it("preserves versioned input mapping through save and flags changes in review", () => {
  const graph = fixture();
  expect(validateVisualGraph(graph).errors).toEqual([]);
  const normalized = normalizeVisualDraft(graph)!;
  expect(
    normalized.nodes.find((n) => n.kind === "action")?.config.action?.inputs
      .email,
  ).toBe("email_registration");
  const changed = structuredClone(graph);
  changed.nodes.find((n) => n.kind === "action")!.config.action!.inputs.email =
    "new_email";
  expect(diffWorkflowGraphs(graph, changed).nodes[0].fields).toContain(
    "config",
  );
});
it("waits for explicit confirmation and takes success or failure without executing in the pure runtime", () => {
  const graph = fixture(),
    versionId = "v1";
  const legacyState = {
    versionId,
    nodeId: "registration_confirm",
    status: "waiting" as const,
    awaiting: true,
    visited: [],
    values: {
      biz_registration: "Shop",
      email_registration: "owner@example.com",
    },
  };
  // Obtain a current review receipt; an arbitrary saved `awaiting` flag is not approval.
  const state = advanceVisualWorkflow({ graph, versionId, state: legacyState, message: "", hasPhoto: false, intent: "unknown" }).state;
  const no = advanceVisualWorkflow({
    graph,
    versionId,
    state,
    message: "jo",
    hasPhoto: false,
    intent: "unknown",
  });
  expect(no.action.kind).toBe("prompt");
  const yes = advanceVisualWorkflow({
    graph,
    versionId,
    state,
    message: "po",
    hasPhoto: false,
    intent: "unknown",
  });
  expect(yes.action.kind).toBe("action");
  expect(yes.state.status).toBe("waiting");
  const success = advanceVisualWorkflow({
    graph,
    versionId,
    state: yes.state,
    message: "",
    hasPhoto: false,
    intent: "unknown",
    actionOutcome: "yes",
  });
  expect(success.action.nodeId).toBe("registration_ok");
  const failure = advanceVisualWorkflow({
    graph,
    versionId,
    state: yes.state,
    message: "",
    hasPhoto: false,
    intent: "unknown",
    actionOutcome: "no",
  });
  expect(failure.action.kind).toBe("handoff");
});
it("blocks unknown action contracts and missing required input bindings", () => {
  const graph = fixture(),
    node = graph.nodes.find((n) => n.kind === "action")!;
  delete node.config.action!.inputs.email;
  expect(validateVisualGraph(graph).errors).not.toEqual([]);
  (node.config.action as unknown as { actionVersion: number }).actionVersion =
    2;
  expect(normalizeVisualDraft(graph)).toBeNull();
});
