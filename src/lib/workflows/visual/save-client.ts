import type { WorkflowOperation } from "./mutations";
import type { VisualGraph } from "./types";
import { unconfirmedSaveMessage, type VisualSaveResult } from "./save-result";

export async function saveWorkflowFromEditor(slug: string, revision: number, operation: WorkflowOperation, graph?: VisualGraph): Promise<VisualSaveResult> {
  try {
    const response = await fetch("/api/workflows/visual", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, revision, operation, graph }),
    });
    const result: VisualSaveResult = await response.json();
    if (result && typeof result.error === "string") return result;
    if (response.ok && result && Number.isInteger(result.savedRevision)) return result;
  } catch { /* Keep the graph and revision intact; an explicit retry uses CAS. */ }
  return { error: unconfirmedSaveMessage };
}
