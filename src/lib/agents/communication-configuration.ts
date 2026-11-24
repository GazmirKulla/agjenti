import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { parseCommunicationPolicy } from "./communication-policy";

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

export async function saveCommunicationConfiguration(businessId: string, userId: string, proposal: Awaited<ReturnType<typeof prepareCommunicationConfiguration>>) {
  const { data, error } = await createServiceSupabase().rpc("save_agent_communication", {
    p_business: businessId, p_user: userId, p_agent: proposal.before.id, p_expected: proposal.before.updated_at,
    p_mode: proposal.mode, p_values: proposal.values,
  });
  if (error || !data || typeof data.published !== "boolean") throw Error("Konfigurimi ndryshoi ose nuk u ruajt. Rifresko dhe rishiko ndryshimet.");
  const inactive = data.active ? "" : " Agjenti është joaktiv, prandaj nuk u përgjigjet ende klientëve.";
  return { message: !data.published ? "Ndryshimet në pritje u hodhën poshtë. Udhëzimet në përdorim mbetën të pandryshuara."
    : proposal.mode === "revert" ? `Versioni ${String(proposal.values?.revision)} u rikthye dhe është në përdorim si versioni ${data.revision}.${inactive}`
    : data.revision === proposal.before.configuration_revision ? "Nuk kishte asgjë për të ndryshuar."
    : `U ruajt. Përgjigjet e reja përdorin versionin ${data.revision}.${inactive} Provoje te Prova dhe kontrolli.`, path: "agents" };
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
