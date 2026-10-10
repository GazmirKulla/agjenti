import { describe, expect, it } from "vitest";
import type { AssistantUIContext } from "@/lib/business-assistant/context";
import { continuesWorkflowRequest, pinnedWorkflowContext, workflowRequestHistory, type WorkflowRequestPin } from "./request-context";

describe("workflow assistant clarification context", () => {
  const original: AssistantUIContext = { page: "workflows", entryPoint: "contextual", workflowSelection: { nodeId: "support", revision: 4, dirty: false } };
  const current: AssistantUIContext = { ...original, workflowSelection: { nodeId: "order", revision: 5, dirty: false } };
  const pin: WorkflowRequestPin = { scope: "studio:workflows", context: original, history: [] };
  it("keeps the original step and revision after selecting another step", () => {
    expect(pinnedWorkflowContext(current, pin).workflowSelection).toEqual(original.workflowSelection);
    expect(original.workflowSelection?.nodeId).toBe("support");
    expect(current.workflowSelection?.nodeId).toBe("order");
  });
  it("still blocks changes when the current editor has unsaved work", () => {
    expect(pinnedWorkflowContext({ ...current, workflowSelection: { ...current.workflowSelection!, dirty: true } }, pin).workflowSelection).toEqual({ nodeId: "support", revision: 4, dirty: true });
  });
  it("uses the new selection after explicit reset and never pins across pages", () => {
    expect(pinnedWorkflowContext(current, null)).toEqual(current);
    const products: AssistantUIContext = { page: "products", entryPoint: "contextual" };
    expect(pinnedWorkflowContext(products, pin)).toEqual(products);
  });
  it("pins freeform clarification and pending proposals, releases saved/read-only results", () => {
    expect(continuesWorkflowRequest({ clarifying: true })).toBe(true);
    expect(continuesWorkflowRequest({ choices: ["Po", "Jo"] })).toBe(true);
    expect(continuesWorkflowRequest({ workflow: { proposed: {} }, token: "signed" })).toBe(true);
    expect(continuesWorkflowRequest({ workflow: {}, token: undefined })).toBe(false);
    expect(continuesWorkflowRequest({ saved: true, clarifying: true })).toBe(false);
  });
  it("preserves the initial request and every answer beyond three clarification rounds", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `answer-${index}` }));
    const compact = workflowRequestHistory(history);
    expect(compact.length).toBeLessThanOrEqual(8);
    for (const message of history) expect(compact.map(item => item.content).join("\n")).toContain(message.content);
  });
  it("reports oversized clarification history rather than silently losing earlier answers", () => {
    const history = Array.from({ length: 10 }, () => ({ role: "user" as const, content: "a".repeat(4000) }));
    expect(() => workflowRequestHistory(history)).toThrow("shumë sqarime");
  });
});
