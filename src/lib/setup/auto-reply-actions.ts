"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { setBusinessAutoReply } from "@/lib/agents/auto-reply";

/** Turns the agent's automatic replies on or off from where the owner looks
 * for them (Kanalet, the home strip); the same gate as the settings switch. */
export async function setAutoReply(slug: string, enabled: boolean): Promise<{ error?: string; success?: string }> {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  try {
    await setBusinessAutoReply(access.business.id, enabled === true, Boolean(access.business.auto_reply));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Ndryshimi nuk u ruajt." };
  }
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return { success: enabled ? "Agjenti tani u përgjigjet klientëve vetë." : "Përgjigjet automatike u fikën. Bisedat i menaxhon ti." };
}
