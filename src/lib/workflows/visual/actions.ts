"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { writeVisualWorkflow, type WorkflowOperation } from "./mutations";
import { loadVisualWorkspace } from "./store";
import type { VisualWorkspace } from "./types";

export type VisualSaveResult = { workspace?: VisualWorkspace; error?: string; errors?: { nodeId?: string; message: string }[] };

async function mutate(slug: string, revision: number, raw: unknown, operation: WorkflowOperation): Promise<VisualSaveResult> {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const result = await writeVisualWorkflow(access.business.id, user.id, revision, raw, operation);
  if (result.error) return result;
  revalidatePath(`/b/${slug}`, "layout");
  return { workspace: await loadVisualWorkspace(access.business.id) };
}
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
