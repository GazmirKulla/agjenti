"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { storeAgentBehavior } from "./behavior";

/** Çfarë bën Agjenti: whether the agent reads voice messages and videos, and what it does when a customer needs a person. */
export async function saveAgentBehavior(slug: string, patch: { voice?: boolean; escalation?: string }) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  const saved = await storeAgentBehavior(access.business.id, user.id, patch);
  if ("error" in saved) return saved;
  revalidatePath(`/b/${access.business.slug}/agents/process`);
  return { success: "U ruajt. Vlen për mesazhet e reja." };
}
