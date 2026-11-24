import type { CommandActor } from "@/lib/actions/command-actor";
import { knowledgeSource } from "./context";
import { ConfigurationError, saveConfiguration } from "@/lib/agent-configuration/service";

/**
 * The knowledge editor's Ruaj, also used by contextual activation. It goes through the agent configuration
 * change: applied with the stamp the owner saw, recorded as a version (the previous ones stay restorable).
 */
export async function saveKnowledgeEntry(actor: CommandActor, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const id = String(formData.get("id") ?? "");
  const expected = String(formData.get("updated_at") ?? "");
  if (!Number.isFinite(Date.parse(expected))) return { error: "Njohuria ndryshoi ose u hoq. Rifresko faqen përpara ruajtjes." };
  try {
    // Activation never rewrites the reviewed text.
    const receipt = formData.get("activation_only") === "true"
      ? await saveConfiguration(actor.business.id, actor.userId, [{ type: "knowledge.active", id, is_active: true, expected }], "owner", requestIdFrom(formData))
      : await saveConfiguration(actor.business.id, actor.userId, [{ type: "knowledge.save", id, title, body, is_active: formData.get("is_active") === "on", expected }], "owner", requestIdFrom(formData));
    return { success: receipt.created ? "U zbatua. Agjenti e përdor në përgjigjet e reja sipas gjendjes “Përdoret nga Agjenti”." : "Nuk kishte asgjë për të ndryshuar." };
  } catch (error) { return { error: error instanceof ConfigurationError ? error.message : "Njohuria nuk u ruajt. Provo përsëri." }; }
}

export async function createKnowledgeEntry(actor: CommandActor, form: FormData, id?: string) {
  const title = String(form.get("title") ?? "").trim(), body = String(form.get("body") ?? "").trim();
  const intent = String(form.get("intent_key") ?? "").trim();
  if (intent.length > 120) return { error: "Plotëso titullin dhe përmbajtjen (deri në 8000 karaktere)." };
  try {
    await saveConfiguration(actor.business.id, actor.userId, [{ type: "knowledge.save", ...(id ? { newId: id } : {}), title, body, intent_key: intent || null,
      is_active: form.get("is_active") !== "false", source: knowledgeSource("owner") }], "owner", requestIdFrom(form));
    return { success: "U zbatua. Njohuria e re përdoret nga Agjenti." };
  } catch (error) { return { error: error instanceof ConfigurationError ? error.message : "Njohuria nuk u krijua. Kontrollo gjendjen para riprovimit." }; }
}

/** The form's own request id (rendered with it), so a repeated submit after a timeout writes once. */
function requestIdFrom(form: FormData) {
  const value = String(form.get("request_id") ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}
