import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { parseCommunicationPolicy } from "./communication-policy";
import { ConfigurationError, saveConfiguration, type ConfigurationRequest } from "@/lib/agent-configuration/service";

export const communicationConfigurationColumns = "id,name,instructions,is_active,updated_at,communication,configuration_revision,configuration_draft";
/**
 * apply: the instructions and/or communication, merged into the ones in use, are saved and used right away.
 * revert: an earlier version is in use again. Both become a new numbered version, so either can be undone.
 * publish / discard: only for a draft saved before changes applied directly; nothing activates it on its own.
 */
export async function prepareCommunicationConfiguration(businessId: string, input: Record<string, unknown>) {
  if (!uuid(input.id) || !["apply", "revert", "publish", "discard"].includes(String(input.mode))) throw Error("Zgjidh agjentin dhe veprimin e konfigurimit.");
  const { data: before, error } = await createServiceSupabase().from("ai_agents").select(communicationConfigurationColumns)
    .eq("business_id", businessId).eq("id", input.id).maybeSingle();
  if (error || !before) throw Error("Konfigurimi i agjentit nuk u lexua.");
  if (input.mode === "apply") {
    const instructions = input.instructions ?? before.instructions;
    if (typeof instructions !== "string" || !instructions.trim() || instructions.length > 8000) throw Error("Plotëso udhëzimet e agjentit.");
    if (input.communication !== undefined && (!input.communication || typeof input.communication !== "object" || Array.isArray(input.communication))) throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
    const values = { instructions: instructions.trim(), communication: parseCommunicationPolicy({ ...before.communication, ...(input.communication as object ?? {}) }) };
    return { before, mode: "apply", values: values as Record<string, unknown>, preview: values as Record<string, unknown> | null };
  }
  if (input.instructions !== undefined || input.communication !== undefined) throw Error("Ky veprim nuk merr ndryshime të reja: përdor Ruaj.");
  if (input.mode === "revert") {
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) throw Error("Zgjidh versionin që dëshiron të rikthesh.");
    if (input.revision === before.configuration_revision) throw Error("Ky version është tashmë në përdorim.");
    const saved = await createServiceSupabase().from("agent_configuration_versions").select("instructions,communication")
      .eq("business_id", businessId).eq("agent_id", input.id).eq("revision", input.revision).maybeSingle();
    if (saved.error || !saved.data) throw Error("Versioni nuk u gjet.");
    return { before, mode: "revert", values: { revision: input.revision } as Record<string, unknown>, preview: saved.data as Record<string, unknown> | null };
  }
  if (input.mode === "publish" && (!before.configuration_draft || before.configuration_draft.baseRevision !== before.configuration_revision))
    throw Error("Ndryshimet në pritje mungojnë ose udhëzimet janë ndryshuar pas tyre. Rishikoji.");
  return { before, mode: String(input.mode), values: null as Record<string, unknown> | null, preview: (input.mode === "publish" ? before.configuration_draft : null) as Record<string, unknown> | null };
}

/** Saves through the agent configuration change, against the agent as the owner saw it (proposal.before). */
export async function saveCommunicationConfiguration(businessId: string, userId: string, proposal: Awaited<ReturnType<typeof prepareCommunicationConfiguration>>, requestId?: string) {
  const before = proposal.before as { id: string; updated_at: string; is_active: boolean };
  if (proposal.mode === "revert") throw Error("Versionet e plota rikthehen nga Historiku.");
  const request: ConfigurationRequest = proposal.mode === "apply"
    ? { type: "agent.update", id: before.id, instructions: String(proposal.values?.instructions), communication: proposal.values?.communication as Record<string, unknown>, expected: before.updated_at }
    : { type: "agent.draft", id: before.id, action: proposal.mode === "publish" ? "apply" : "discard", expected: before.updated_at };
  try {
    const receipt = await saveConfiguration(businessId, userId, [request], "owner", requestId);
    const inactive = before.is_active ? "" : " Agjenti është joaktiv, prandaj nuk u përgjigjet ende klientëve.";
    return { message: proposal.mode === "discard" ? "Ndryshimet në pritje u hodhën poshtë. Udhëzimet në përdorim mbetën të pandryshuara."
      : receipt.created ? `U zbatua. Përgjigjet e reja përdorin konfigurimin e ri (versioni ${receipt.revision}).${inactive}` : "Nuk kishte asgjë për të ndryshuar.", path: "agents", revision: receipt.revision };
  } catch (error) { throw Error(error instanceof ConfigurationError ? error.message : "Konfigurimi ndryshoi ose nuk u ruajt. Rifresko dhe rishiko ndryshimet."); }
}

export type AgentConfigurationPreview = { businessId: string; agentId: string; name: string; instructions: string;
  communication: ReturnType<typeof parseCommunicationPolicy>; updatedAt: string; revision: number };
/** Only an authenticated isolated test caller may supply the returned snapshot. */
export async function loadCommunicationDraft(businessId: string, agentId: string): Promise<AgentConfigurationPreview> {
  if (!uuid(agentId)) throw Error("Zgjidh një draft të vlefshëm.");
  const { data, error } = await createServiceSupabase().from("ai_agents").select(communicationConfigurationColumns)
    .eq("business_id", businessId).eq("id", agentId).maybeSingle();
  if (error || !data?.configuration_draft || data.configuration_draft.baseRevision !== data.configuration_revision)
    throw Error("Drafti mungon ose ka ndryshuar. Rishiko konfigurimin.");
  return { businessId, agentId, name: data.name, instructions: data.configuration_draft.instructions,
    communication: parseCommunicationPolicy(data.configuration_draft.communication), updatedAt: data.updated_at, revision: data.configuration_revision };
}
