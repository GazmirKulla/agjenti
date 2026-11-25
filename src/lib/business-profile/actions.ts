"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { ConfigurationError, saveConfiguration } from "@/lib/agent-configuration/service";
import { findProfileOverlaps, SelectionUnavailable } from "./overlap";

/** Agjenti → Biznesi → Ruaj: the whole profile, against the version the owner opened, as one configuration change. */
export async function saveBusinessProfile(slug: string, formData: FormData) {
  let actor;
  try { actor = await manualCommandActor(slug); } catch (error) { return { error: (error as Error).message }; }
  let profile: unknown;
  try { profile = JSON.parse(String(formData.get("profile") ?? "")); } catch { return { error: "Profili nuk u lexua. Rifresko faqen." }; }
  const requestId = String(formData.get("request_id") ?? "");
  try {
    const receipt = await saveConfiguration(actor.business.id, actor.userId, [{ type: "profile.set", profile, expected: String(formData.get("expected") ?? "") || undefined }], "owner",
      /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : undefined);
    revalidatePath(`/b/${actor.business.slug}`, "layout");
    return { success: receipt.created ? `U zbatua: ${receipt.lines.map(line => line.label.replace("Profili · ", "")).join(", ")}. Agjenti e përdor në përgjigjet e reja.` : "Nuk kishte asgjë për të ndryshuar.",
      next: { href: "#prova", label: "Provo Agjentin" } };
  } catch (error) { return { error: error instanceof ConfigurationError ? error.message : "Profili nuk u ruajt. Asgjë nuk u ndryshua." }; }
}

/** Biznesi → "Kontrollo njohuritë": knowledge that may repeat the profile, for the owner to decide. Changes nothing. */
export async function checkProfileOverlaps(slug: string) {
  let actor;
  try { actor = await manualCommandActor(slug); } catch (error) { return { error: (error as Error).message }; }
  try { return { overlaps: await findProfileOverlaps(actor.business.id) }; }
  catch (error) {
    return { error: error instanceof SelectionUnavailable ? "Kontrolli nuk u krye (AI nuk u përgjigj). Asgjë nuk ndryshoi; provo përsëri." : (error as Error).message };
  }
}

/** The owner keeps the profile as the one source: the repeating knowledge is switched off (not deleted), as one versioned change. */
export async function switchOffRepeatingKnowledge(slug: string, id: string, expected: string) {
  let actor;
  try { actor = await manualCommandActor(slug); } catch (error) { return { error: (error as Error).message }; }
  try {
    await saveConfiguration(actor.business.id, actor.userId, [{ type: "knowledge.active", id, is_active: false, expected }], "owner");
    revalidatePath(`/b/${actor.business.slug}`, "layout");
    return { success: "U zbatua: njohuria u fik; Agjenti përdor profilin. Mund ta ndezësh sërish te Oferta." };
  } catch (error) { return { error: error instanceof ConfigurationError ? error.message : "Njohuria nuk u fik. Asgjë nuk ndryshoi." }; }
}
