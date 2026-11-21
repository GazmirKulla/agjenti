"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";
import { LOGO_TYPES, refreshInstagramBusinessLogo, removeBusinessLogo, storeBusinessLogo } from "./logo";

/** Server actions accept 2 MB bodies; the form shrinks the image before sending. */
const MAX_UPLOAD = 1_900_000;

/** The owner's own logo. It replaces the Instagram photo and Instagram never replaces it. */
export async function uploadBusinessLogo(slug: string, formData: FormData): Promise<{ success: string } | { error: string }> {
  let actor;
  try { actor = await manualCommandActor(slug); }
  catch (error) { return { error: (error as Error).message }; }
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Zgjidh një foto." };
  if (!LOGO_TYPES[file.type]) return { error: "Logoja duhet të jetë JPG, PNG ose WebP." };
  if (file.size > MAX_UPLOAD) return { error: "Fotoja është shumë e madhe. Provo një foto më të vogël." };
  const url = await storeBusinessLogo(createServiceSupabase(), actor.business.id, new Uint8Array(await file.arrayBuffer()), file.type, "manual");
  if (!url) return { error: "Logoja nuk u ruajt. Provo përsëri me një foto tjetër." };
  revalidatePath(`/b/${actor.business.slug}`, "layout");
  return { success: "Logoja u ruajt." };
}

/** Removes the logo; with Instagram connected, its profile photo comes back right away. */
export async function deleteBusinessLogo(slug: string): Promise<{ success: string } | { error: string }> {
  let actor;
  try { actor = await manualCommandActor(slug); }
  catch (error) { return { error: (error as Error).message }; }
  const db = createServiceSupabase();
  if (!(await removeBusinessLogo(db, actor.business.id))) return { error: "Logoja nuk u hoq. Provo përsëri." };
  const instagram = await refreshInstagramBusinessLogo(db, actor.business.id);
  revalidatePath(`/b/${actor.business.slug}`, "layout");
  return { success: instagram === "stored" ? "Logoja u hoq; tani përdoret foto e Instagram-it." : "Logoja u hoq." };
}
