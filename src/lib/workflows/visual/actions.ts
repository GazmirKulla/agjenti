"use server";
import { mutateVisualWorkflow as mutate } from "./save-service";
export type { VisualSaveResult } from "./save-result";
export async function saveVisualWorkflow(slug: string, revision: number, graph: unknown) {
  return mutate(slug, revision, graph, "draft");
}
export async function publishVisualWorkflow(slug: string, revision: number, graph: unknown) {
  return mutate(slug, revision, graph, "publish");
}
export async function setVisualWorkflowEnabled(slug: string, revision: number, enabled: boolean) {
  if (typeof enabled !== "boolean") return { error: "Kërkesë e pavlefshme." };
  return mutate(slug, revision, null, enabled ? "enable" : "disable");
}
