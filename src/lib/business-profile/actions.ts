"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { ConfigurationError, saveConfiguration } from "@/lib/agent-configuration/service";

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
