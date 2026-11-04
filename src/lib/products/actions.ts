"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import * as commands from "./commands";
export async function createProduct(slug: string, input: Parameters<typeof commands.createProduct>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.createProduct(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function updateProduct(slug: string, input: Parameters<typeof commands.updateProduct>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.updateProduct(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function deleteProduct(slug: string, input: Parameters<typeof commands.deleteProduct>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.deleteProduct(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function linkExternalProduct(slug: string, input: Parameters<typeof commands.linkExternalProduct>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.linkExternalProduct(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function importProductBatch(slug: string, input: Parameters<typeof commands.importProductBatch>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.importProductBatch(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
export async function bulkConfigureProducts(slug: string, input: Parameters<typeof commands.bulkConfigureProducts>[1]) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await commands.bulkConfigureProducts(actor, input);
    if (!("error" in result) || !result.error) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
