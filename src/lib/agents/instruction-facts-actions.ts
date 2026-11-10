"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { withAiUsage } from "@/lib/ai/usage";
import { applyInstructionSplit, loadReviewedAgent, proposeInstructionSplit, type InstructionFact } from "./instruction-facts";

type Proposal = { agentId: string; updatedAt: string; instructions: string; facts: InstructionFact[]; notes?: string[] };

async function authorize(slug: string) {
  const user = await getSessionUser();
  if (!user) throw Error("Sesioni ka skaduar. Hyr përsëri.");
  const access = typeof slug === "string" && slug.length <= 150 ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) throw Error("Nuk ke qasje në këtë biznes.");
  return { userId: user.id, business: access.business };
}

/** Finds the facts written into the agent's instructions. */
export async function checkInstructionFacts(slug: string): Promise<{ proposal: Proposal | null; notes: string[] } | { error: string }> {
  try {
    const { business } = await authorize(slug);
    const agent = await loadReviewedAgent(business.id);
    if (!agent?.instructions?.trim()) return { proposal: null, notes: [] };
    const split = await withAiUsage(business.id, () => proposeInstructionSplit(agent.instructions));
    return { proposal: split.facts.length ? { agentId: agent.id, updatedAt: agent.updated_at, ...split } : null, notes: split.notes };
  } catch (error) { return { error: error instanceof Error ? error.message : "Kontrolli nuk u krye." }; }
}

/** Moves the confirmed facts to Knowledge and publishes the shorter instructions. */
export async function moveInstructionFacts(slug: string, proposal: Proposal): Promise<{ success: string } | { error: string }> {
  try {
    const { business, userId } = await authorize(slug);
    const result = await applyInstructionSplit(business.id, userId, proposal ?? {});
    revalidatePath(`/b/${business.slug}`, "layout");
    return { success: `${result.knowledge} njohuri u shtuan te Njohuritë. ${result.message}` };
  } catch (error) { return { error: error instanceof Error ? error.message : "Ndryshimi nuk u ruajt." }; }
}
