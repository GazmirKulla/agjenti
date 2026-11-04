import { expect, it } from "vitest";
import { workflowExecutionPolicy } from "./execution-policy";
import { emptyState } from "./engine";
it("new requests select the business visual workflow without a second definition", () => {
  expect(workflowExecutionPolicy({ state: emptyState() })).toEqual({ kind: "visual", previous: undefined, selected: undefined, pinnedId: undefined });
});
it("keeps an unfinished legacy order on its saved adapter", () => {
  const state = { ...emptyState(), product_id: "product", step_key: "collect_customer" };
  expect(workflowExecutionPolicy({ state }).kind).toBe("legacy_continuation");
  expect(workflowExecutionPolicy({ state, informationRequest: true }).kind).toBe("visual");
  expect(workflowExecutionPolicy({ state: { ...state, step_key: "order_ready" } }).kind).toBe("visual");
});
it("keeps the immutable version of a running visual process", () => {
  const state = { ...emptyState(), visual: { versionId: "v1", nodeId: "email", status: "waiting" as const, awaiting: true, visited: [], values: {} } };
  expect(workflowExecutionPolicy({ state })).toMatchObject({ kind: "visual", pinnedId: "v1" });
  expect(state.visual.versionId).toBe("v1");
});
