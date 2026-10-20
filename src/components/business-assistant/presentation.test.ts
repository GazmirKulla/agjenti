import { describe, expect, it } from "vitest";
import { businessGoals, contextualAction } from "./presentation";
import { assistantContextKey, pinnedWorkflowContext } from "./request-context";
import type { AssistantUIContext } from "@/lib/business-assistant/context";

const home: AssistantUIContext = { page: "home", entryPoint: "home" };
const product: AssistantUIContext = { page: "products", entryPoint: "contextual", entityType: "product", entityId: "p1", selectedEntityIds: ["p1"] };

describe("one Migo presentation", () => {
  it("offers plain business goals without technical publication suggestions", () => {
    const goals = businessGoals(home, ["products", "services", "knowledge", "agents", "workflows"], false);
    expect(goals.map(goal => goal.module)).toEqual(["products", "services", "knowledge", "agents"]);
    expect(goals.some(goal => /publik|workflow/i.test(goal.text))).toBe(false);
    expect(businessGoals(home, ["workflows"], false)).toEqual([]);
    expect(businessGoals(home, ["products", "knowledge"], true).map(goal => goal.module)).toEqual(["knowledge"]);
  });
  it("keeps the configured identity and selected record in contextual entry labels", () => {
    expect(contextualAction(product, "Luna", ["products"])).toBe("Pyet Luna për këtë produkt");
    expect(contextualAction({ ...product, entityId: undefined, selectedEntityIds: ["p1", "p2"] }, "Migo", ["products"])).toContain("produktet e zgjedhura");
    expect(contextualAction({ page: "services", entityId: "s1", entryPoint: "contextual" }, "Migo", ["services"])).toBe("Ndrysho këtë shërbim me Migo");
    expect(contextualAction({ page: "knowledge", entryPoint: "contextual" }, "Migo", ["knowledge"])).toBe("Përditëso njohuritë me Migo");
    expect(contextualAction({ page: "agents", entryPoint: "contextual" }, "Migo", ["agents"])).toContain("agjentin e klientëve");
    expect(contextualAction(product, "Migo", [])).toBeNull();
  });
  it("uses the actual request history boundary for page, selection, filter and tenant notices", () => {
    const key = assistantContextKey("shop", product);
    for (const context of [home, { ...product, entityId: "p2" }, { ...product, searchQuery: "other" }]) {
      expect(assistantContextKey("shop", context)).not.toBe(key);
    }
    expect(assistantContextKey("other", product)).not.toBe(key);
    expect(assistantContextKey("shop", structuredClone(product))).toBe(key);
  });
  it("keeps workflow continuation pinned while retaining unsaved-change safeguards", () => {
    const original: AssistantUIContext = { page: "workflows", entryPoint: "contextual", workflowSelection: { nodeId: "a", flowId: "flow-a", revision: 7, dirty: false } };
    const current: AssistantUIContext = { ...original, workflowSelection: { nodeId: "b", flowId: "flow-b", revision: 8, dirty: true } };
    const scope = assistantContextKey("shop", original);
    expect(assistantContextKey("shop", current)).toBe(scope);
    expect(pinnedWorkflowContext(current, { scope, context: original, history: [] }).workflowSelection).toEqual({ nodeId: "a", flowId: "flow-a", revision: 7, dirty: true });
  });
});
