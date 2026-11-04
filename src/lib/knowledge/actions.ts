"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { saveKnowledgeEntry as save } from "./commands";
export async function saveKnowledgeEntry(slug: string, formData: FormData) {
  let actor;
  try { actor = await manualCommandActor(slug); }
  catch (error) { return { error: (error as Error).message }; }
  const result = await save(actor, formData);
  // Let the calling boundary distinguish cache failures after an acknowledged write.
  if (!result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
  return result;
}
