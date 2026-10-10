import { normalizeVisualDraft } from "./model";
import type { VisualGraph, VisualWorkspace } from "./types";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SavedWorkspace = Pick<VisualWorkspace, "revision" | "graph">;
export type LocalWorkflowDraft = {
  format: 1;
  slug: string;
  baseRevision: number;
  savedAt: number;
  graph: VisualGraph;
};
export type WorkflowDraftRecovery =
  | { status: "none" | "invalid" | "unavailable" }
  | { status: "saved" | "recoverable" | "conflict"; draft: LocalWorkflowDraft };

export function workflowDraftStorageKey(slug: string) {
  return `agjenti.workflow-draft.v1:${encodeURIComponent(slug)}`;
}

function storageOrDefault(storage?: DraftStorage | null): DraftStorage | null {
  // Access itself can throw when browser storage is disabled.
  return storage === undefined ? typeof window === "undefined" ? null : window.sessionStorage : storage;
}

function normalized(raw: unknown): VisualGraph | null {
  try { return normalizeVisualDraft(raw); } catch { return null; }
}

function sameGraph(left: VisualGraph, right: VisualGraph) {
  // Normalization fixes object-key order and removes unknown/undefined fields.
  const a = normalized(left), b = normalized(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function decode(raw: string, slug: string): LocalWorkflowDraft | null {
  if (raw.length > 110000) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.format !== 1 || value.slug !== slug ||
      !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 ||
      !Number.isSafeInteger(value.savedAt) || value.savedAt < 0) return null;
    const graph = normalized(value.graph);
    return graph ? { format: 1, slug, baseRevision: value.baseRevision, savedAt: value.savedAt, graph } : null;
  } catch { return null; }
}

/** Inspect only. The caller must explicitly offer recovery or conflict resolution. */
export function readWorkflowDraftRecovery(slug: string, workspace: SavedWorkspace, storage?: DraftStorage | null): WorkflowDraftRecovery {
  try {
    const target = storageOrDefault(storage);
    if (!target) return { status: "unavailable" };
    const raw = target.getItem(workflowDraftStorageKey(slug));
    if (raw === null) return { status: "none" };
    const draft = decode(raw, slug);
    if (!draft) return { status: "invalid" };
    if (draft.baseRevision <= workspace.revision && sameGraph(draft.graph, workspace.graph)) return { status: "saved", draft };
    return { status: draft.baseRevision === workspace.revision ? "recoverable" : "conflict", draft };
  } catch { return { status: "unavailable" }; }
}

/** Store an edit in this tab only; never overwrite an unresolved draft from another revision. */
export function persistWorkflowDraft(slug: string, baseRevision: number, graph: VisualGraph, storage?: DraftStorage | null): { status: "saved" | "invalid" | "unavailable" | "conflict" } {
  const clean = normalized(graph);
  if (!slug || !Number.isSafeInteger(baseRevision) || baseRevision < 0 || !clean) return { status: "invalid" };
  try {
    const target = storageOrDefault(storage);
    if (!target) return { status: "unavailable" };
    const key = workflowDraftStorageKey(slug), previous = target.getItem(key);
    const existing = previous === null ? null : decode(previous, slug);
    if (existing && existing.baseRevision !== baseRevision) return { status: "conflict" };
    const draft: LocalWorkflowDraft = { format: 1, slug, baseRevision, savedAt: Date.now(), graph: clean };
    const raw = JSON.stringify(draft);
    if (raw.length > 110000) return { status: "invalid" };
    target.setItem(key, raw);
    return { status: "saved" };
  } catch { return { status: "unavailable" }; }
}

/** Clear after a confirmed save only when the acknowledged graph includes these exact edits. */
export function clearSavedWorkflowDraft(slug: string, workspace: SavedWorkspace, storage?: DraftStorage | null): { status: "cleared" | "retained" | "unavailable" } {
  try {
    const target = storageOrDefault(storage);
    if (!target) return { status: "unavailable" };
    const key = workflowDraftStorageKey(slug), raw = target.getItem(key);
    if (raw === null) return { status: "cleared" };
    const draft = decode(raw, slug);
    if (!draft || draft.baseRevision > workspace.revision || !sameGraph(draft.graph, workspace.graph)) return { status: "retained" };
    target.removeItem(key);
    return { status: "cleared" };
  } catch { return { status: "unavailable" }; }
}

/** Explicit user discard; this never changes the server's draft. */
export function clearWorkflowDraft(slug: string, storage?: DraftStorage | null): boolean {
  try {
    const target = storageOrDefault(storage);
    if (!target) return false;
    target.removeItem(workflowDraftStorageKey(slug));
    return true;
  } catch { return false; }
}
