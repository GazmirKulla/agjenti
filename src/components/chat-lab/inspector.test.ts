import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "./inspector";
import type { LabTurn } from "@/lib/chat-lab/model";
import { emptyState } from "@/lib/workflows/state";
const turn = {
  turns: 1, debug: { elapsedMs: 10, source: "ai" },
  trace: [], nextState: { ...emptyState(), step_key: "old_step" },
  workflowId: "old-workflow", workflowProgress: [], fields: [], warnings: [],
} as unknown as LabTurn;
it("labels carried state without claiming a workflow ran or is in progress", () => {
  const html = renderToStaticMarkup(createElement(Inspector, { turn, tab: "workflow", onTab: () => {} }));
  expect(html).toContain("Nuk ka dëshmi ekzekutimi");
  expect(html).toContain("old-workflow");
  expect(html).toContain("old_step");
  expect(html).not.toContain("in progress");
  expect(html).not.toContain("no workflow steps executed");
});
it("shows the version and nodes recorded during execution, not a later active version", () => {
  const observed: LabTurn = { ...turn, trace: [{ stage: "workflow", label: "Visual workflow executed", elapsedMs: 8, data: {
    workflowName: "Customer journey", versionId: "actual-pinned-version", workflowSource: "pinned", businessId: "tenant", executionMode: "isolated", fromNodeId: "question", currentNodeId: "confirm", traversedNodeIds: ["question", "confirm"],
  } }] };
  const html = renderToStaticMarkup(createElement(Inspector, { turn: observed, tab: "workflow", onTab: () => {} }));
  for (const value of ["Customer journey", "actual-pinned-version", "question", "confirm", "isolated"]) expect(html).toContain(value);
  expect(html).toContain("Ekzekutim i workflow-t vizual");
  expect(html).not.toContain("Nuk ka dëshmi ekzekutimi");
});
