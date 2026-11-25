"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { storeAgentBehavior } from "./behavior";

/** Çfarë bën Agjenti: whether the agent reads voice messages and videos, and what it does when a customer needs a person. */
export async function saveAgentBehavior(slug: string, patch: { voice?: boolean; escalation?: string }): Promise<{ error?: string; success?: string }> {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const saved = await storeAgentBehavior(access.business.id, user.id, patch);
  if ("error" in saved) return { error: saved.error };
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: "U ruajt. Vlen për mesazhet e reja." };
}
