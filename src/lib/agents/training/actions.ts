"use server";
import * as commands from "./commands";
import type { TrainingTarget, TrainingInput } from "./model";
import { revalidatePath } from "next/cache";
async function actor(target: TrainingTarget) {
  return commands.accessTraining(target);
}
export async function listAgentTraining(target: TrainingTarget) { return commands.listAgentTraining(target); }
export async function saveAgentTraining(target: TrainingTarget, input: TrainingInput) {
  try {
    const context = await actor(target);
    const result = await commands.saveAgentTraining(context, input);
    if (!("error" in result)) { revalidatePath(`/b/${context.business.slug}`, "layout"); revalidatePath("/admin/chat-lab"); }
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function changeAgentTraining(target: TrainingTarget, input: Parameters<typeof commands.changeAgentTraining>[1]) {
  try {
    const context = await actor(target);
    const result = await commands.changeAgentTraining(context, input);
    if (!("error" in result)) { revalidatePath(`/b/${context.business.slug}`, "layout"); revalidatePath("/admin/chat-lab"); }
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
