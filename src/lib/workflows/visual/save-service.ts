import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { writeVisualWorkflow, type WorkflowOperation } from "./mutations";
import { loadVisualWorkspace } from "./store";
import type { VisualSaveResult } from "./save-result";

export async function mutateVisualWorkflow(slug: string, revision: number, raw: unknown, operation: WorkflowOperation): Promise<VisualSaveResult> {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const result = await writeVisualWorkflow(access.business.id, user.id, revision, raw, operation);
  if (result.error) return result;

  // A cache/refresh failure after this point is not a failed database write.
  let warning: string | undefined;
  try { revalidatePath(`/b/${slug}`, "layout"); }
  catch { warning = "Ndryshimi u ruajt. Rifresko faqen për të përditësuar pamjen."; }
  try {
    return { ...result, workspace: await loadVisualWorkspace(access.business.id), warning };
  } catch {
    return { ...result, refreshRequired: true, warning: "Ndryshimi u ruajt, por pamja nuk u ngarkua. Rifresko faqen për të vazhduar." };
  }
}
