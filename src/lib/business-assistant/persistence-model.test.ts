import { expect, it } from "vitest";
import { hasRecoverableWork, modelHistory, modelPlanContext, planningPreferences, safePlanSnapshot, type RecoverablePlan, type StoredMessage } from "./persistence-model";

it("persists only the recovery envelope, never nested tickets or authorization", () => {
  const raw = { version: 1, request: "Plan", token: "live-ticket", pendingToken: "secret", saved: true,
    preview: { title: "Preview", fields: [], token: "nested-ticket", publicationApproval: { valid: true } } };
  const saved = safePlanSnapshot(raw as RecoverablePlan);
  expect(saved).toEqual({ version: 1, request: "Plan", preview: { title: "Preview", fields: [] } });
  expect(JSON.stringify(saved)).not.toMatch(/ticket|secret|saved|Approval/);
});
it("limits snapshots rather than silently truncating a proposed change", () => {
  expect(() => safePlanSnapshot({ version: 1, request: "x".repeat(524289) })).toThrow();
});
it("large recoverable snapshots are not blindly sent to the model", () => {
  const plan: RecoverablePlan = { version: 1, request: "x".repeat(65000) };
  expect(safePlanSnapshot(plan).request).toHaveLength(65000);
  expect(() => modelPlanContext(plan)).toThrow("tepër i madh");
});
it("plain conversation replies and closed plans are not unfinished approval cards", () => {
  expect(hasRecoverableWork({ version: 1, request: "", message: "Plani u mbyll pa ekzekutim." })).toBe(false);
  expect(hasRecoverableWork({ version: 1, request: "edit", preview: { title: "Draft", fields: [] } })).toBe(true);
});
it("planning preferences cannot carry execution or authorization claims", () => {
  expect(planningPreferences({ step: "included", later: "deferred" })).toEqual({ step: "included", later: "deferred" });
  for (const value of [{ step: "approved" }, { executed: true }, { token: "credential" }, [], null])
    expect(() => planningPreferences(value)).toThrow();
});
it("model history is bounded, preserves order and distinguishes backend outcomes from assistant claims", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", kind: "assistant", content: String(i) })) as StoredMessage[];
  rows.push({ role: "assistant", kind: "interrupted", content: "not a result" } as StoredMessage);
  rows.push({ role: "assistant", kind: "backend_outcome", content: "saved" } as StoredMessage);
  const history = modelHistory(rows);
  expect(history).toHaveLength(8);
  expect(history[0].content).toBe("23");
  expect(history.at(-1)?.content).toContain("jo leje për veprim të ri");
  expect(history.some(m => m.content === "not a result")).toBe(false);
});
