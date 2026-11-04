"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { updateCatalogField as updateField } from "./field-command";
export async function updateCatalogField(slug: string, change: Parameters<typeof updateField>[1]) {
  let actor;
  try { actor = await manualCommandActor(slug); }
  catch (error) { return { error: (error as Error).message }; }
  const result = await updateField(actor, change);
  // Let the calling boundary distinguish cache failures after an acknowledged write.
  if (!result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
  return result;
}
