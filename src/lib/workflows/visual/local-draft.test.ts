import { describe, expect, it, vi } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "./model";
import { clearSavedWorkflowDraft, clearWorkflowDraft, persistWorkflowDraft, readWorkflowDraftRecovery, workflowDraftStorageKey } from "./local-draft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
const workspace = () => ({ revision: 7, graph: upgradeVisualGraph(starterVisualGraph()) });
const editedGraph = () => ({ ...workspace().graph, name: "Ndryshimi i paruajtur" });

describe("local workflow draft recovery", () => {
  it("offers exact-revision recovery without changing the server graph or storage", () => {
    const storage = memoryStorage(), saved = workspace(), edited = editedGraph();
    expect(persistWorkflowDraft("business-a", 7, edited, storage)).toEqual({ status: "saved" });
    storage.setItem.mockClear();
    const result = readWorkflowDraftRecovery("business-a", saved, storage);
    expect(result).toMatchObject({ status: "recoverable", draft: { slug: "business-a", baseRevision: 7, graph: { name: edited.name } } });
    expect(saved.graph.name).not.toBe(edited.name);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([6, 8])("keeps revision %s separate from a draft based on revision 7", revision => {
    const storage = memoryStorage();
    persistWorkflowDraft("business-a", 7, editedGraph(), storage);
    expect(readWorkflowDraftRecovery("business-a", { ...workspace(), revision }, storage)).toMatchObject({ status: "conflict", draft: { baseRevision: 7 } });
    const original = storage.getItem(workflowDraftStorageKey("business-a"));
    expect(persistWorkflowDraft("business-a", revision, workspace().graph, storage)).toEqual({ status: "conflict" });
    expect(storage.getItem(workflowDraftStorageKey("business-a"))).toBe(original);
  });

  it("clears only an acknowledged saved graph and recognizes an already persisted response", () => {
    const storage = memoryStorage(), edited = editedGraph();
    persistWorkflowDraft("business-a", 7, edited, storage);
    const acknowledged = { revision: 8, graph: edited };
    expect(readWorkflowDraftRecovery("business-a", acknowledged, storage)).toMatchObject({ status: "saved" });
    expect(clearSavedWorkflowDraft("business-a", acknowledged, storage)).toEqual({ status: "cleared" });
    expect(readWorkflowDraftRecovery("business-a", acknowledged, storage)).toEqual({ status: "none" });
  });

  it("retains further local edits when a save acknowledges an older graph", () => {
    const storage = memoryStorage();
    persistWorkflowDraft("business-a", 7, editedGraph(), storage);
    expect(clearSavedWorkflowDraft("business-a", { ...workspace(), revision: 8 }, storage)).toEqual({ status: "retained" });
    expect(readWorkflowDraftRecovery("business-a", workspace(), storage)).toMatchObject({ status: "recoverable" });
  });

  it("does not clear a draft based on a newer revision even when its graph matches", () => {
    const storage = memoryStorage(), edited = editedGraph();
    persistWorkflowDraft("business-a", 9, edited, storage);
    expect(clearSavedWorkflowDraft("business-a", { revision: 8, graph: edited }, storage)).toEqual({ status: "retained" });
    expect(readWorkflowDraftRecovery("business-a", { revision: 8, graph: edited }, storage)).toMatchObject({ status: "conflict" });
  });

  it("ignores JSON object ordering when checking confirmed saves", () => {
    const storage = memoryStorage(), graph = editedGraph();
    persistWorkflowDraft("business-a", 7, graph, storage);
    const reversed = Object.fromEntries(Object.entries(graph).reverse()) as typeof graph;
    expect(clearSavedWorkflowDraft("business-a", { revision: 8, graph: reversed }, storage)).toEqual({ status: "cleared" });
  });

  it("isolates businesses and discards only the selected business's local draft", () => {
    const storage = memoryStorage();
    persistWorkflowDraft("business-a", 7, editedGraph(), storage);
    persistWorkflowDraft("business/b", 7, editedGraph(), storage);
    expect(readWorkflowDraftRecovery("business-c", workspace(), storage)).toEqual({ status: "none" });
    expect(clearWorkflowDraft("business-a", storage)).toBe(true);
    expect(readWorkflowDraftRecovery("business-a", workspace(), storage)).toEqual({ status: "none" });
    expect(readWorkflowDraftRecovery("business/b", workspace(), storage)).toMatchObject({ status: "recoverable" });
  });

  it.each([
    "broken json", "null", "[]", "x".repeat(110001),
    JSON.stringify({ format: 1, slug: "business-a", baseRevision: -1, savedAt: 1, graph: editedGraph() }),
    JSON.stringify({ format: 1, slug: "business-a", baseRevision: 7, savedAt: "yesterday", graph: editedGraph() }),
    JSON.stringify({ format: 2, slug: "business-a", baseRevision: 7, savedAt: 1, graph: editedGraph() }),
    JSON.stringify({ format: 1, slug: "business-b", baseRevision: 7, savedAt: 1, graph: editedGraph() }),
    JSON.stringify({ format: 1, slug: "business-a", baseRevision: 7, savedAt: 1, graph: {} }),
  ])("rejects malformed or foreign stored data %# without throwing", raw => {
    const storage = memoryStorage();
    storage.setItem(workflowDraftStorageKey("business-a"), raw);
    expect(readWorkflowDraftRecovery("business-a", workspace(), storage)).toEqual({ status: "invalid" });
    expect(clearSavedWorkflowDraft("business-a", workspace(), storage)).toEqual({ status: "retained" });
  });

  it("preserves structurally valid unfinished drafts without requiring publish validity", () => {
    const storage = memoryStorage(), graph = editedGraph();
    graph.edges = [];
    expect(persistWorkflowDraft("business-a", 7, graph, storage)).toEqual({ status: "saved" });
    expect(readWorkflowDraftRecovery("business-a", workspace(), storage)).toMatchObject({ status: "recoverable", draft: { graph: { edges: [] } } });
  });

  it("does not destroy a prior draft if browser quota rejects a new edit", () => {
    const storage = memoryStorage();
    persistWorkflowDraft("business-a", 7, editedGraph(), storage);
    const original = storage.getItem(workflowDraftStorageKey("business-a"));
    storage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    expect(persistWorkflowDraft("business-a", 7, workspace().graph, storage)).toEqual({ status: "unavailable" });
    expect(storage.getItem(workflowDraftStorageKey("business-a"))).toBe(original);
  });

  it("reports unavailable storage for read/write/discard without crashing the editor", () => {
    const storage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } };
    expect(readWorkflowDraftRecovery("business-a", workspace(), storage)).toEqual({ status: "unavailable" });
    expect(persistWorkflowDraft("business-a", 7, editedGraph(), storage)).toEqual({ status: "unavailable" });
    expect(clearSavedWorkflowDraft("business-a", workspace(), storage)).toEqual({ status: "unavailable" });
    expect(clearWorkflowDraft("business-a", storage)).toBe(false);
    expect(readWorkflowDraftRecovery("business-a", workspace(), null)).toEqual({ status: "unavailable" });
  });
});
