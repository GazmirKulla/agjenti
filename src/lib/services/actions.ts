"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { saveBusinessService as saveService } from "./commands";
export async function saveBusinessService(slug: string, form: FormData) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await saveService(actor, form);
    if (!("error" in result)) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
