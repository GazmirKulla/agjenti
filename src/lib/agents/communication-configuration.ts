import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { parseCommunicationPolicy } from "./communication-policy";

export const communicationConfigurationColumns = "id,name,instructions,is_active,updated_at,communication,configuration_revision,configuration_draft";
export async function prepareCommunicationConfiguration(businessId: string, input: Record<string, unknown>) {
  if (!uuid(input.id) || !["draft", "publish", "discard", "restore"].includes(String(input.mode))) throw Error("Zgjidh agjentin dhe veprimin e konfigurimit.");
  const { data: before, error } = await createServiceSupabase().from("ai_agents").select(communicationConfigurationColumns)
    .eq("business_id", businessId).eq("id", input.id).maybeSingle();
  if (error || !before) throw Error("Konfigurimi i agjentit nuk u lexua.");
  let values: Record<string, unknown> | null = null;
  if (input.mode === "draft") {
    const base = before.configuration_draft ?? before;
    const instructions = input.instructions ?? base.instructions;
    if (typeof instructions !== "string" || !instructions.trim() || instructions.length > 8000) throw Error("Plotëso udhëzimet e agjentit.");
    if (input.communication !== undefined && (!input.communication || typeof input.communication !== "object" || Array.isArray(input.communication))) throw Error("Konfigurimi i komunikimit nuk është i vlefshëm.");
    values = { instructions: instructions.trim(), communication: parseCommunicationPolicy({ ...base.communication, ...(input.communication as object ?? {}) }) };
  } else {
    if (input.instructions !== undefined || input.communication !== undefined) throw Error("Ruaj ndryshimet si draft përpara publikimit.");
    if (input.mode === "publish" && (!before.configuration_draft || before.configuration_draft.baseRevision !== before.configuration_revision)) throw Error("Drafti mungon ose konfigurimi aktiv ka ndryshuar. Rishiko draftin.");
    if (input.mode === "restore") {
      if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) throw Error("Zgjidh versionin që dëshiron të rikthesh si draft.");
      const saved = await createServiceSupabase().from("agent_configuration_versions").select("instructions,communication")
        .eq("business_id", businessId).eq("agent_id", input.id).eq("revision", input.revision).maybeSingle();
      if (saved.error || !saved.data) throw Error("Versioni nuk u gjet.");
      values = { revision: input.revision };
      return { before, mode: String(input.mode), values, preview: saved.data };
    }
  }
  return { before, mode: String(input.mode), values, preview: input.mode === "publish" ? before.configuration_draft : values };
}

export async function saveCommunicationConfiguration(businessId: string, userId: string, proposal: Awaited<ReturnType<typeof prepareCommunicationConfiguration>>) {
  const { data, error } = await createServiceSupabase().rpc("save_agent_communication", {
    p_business: businessId, p_user: userId, p_agent: proposal.before.id, p_expected: proposal.before.updated_at,
    p_mode: proposal.mode, p_values: proposal.values,
  });
  if (error || !data || typeof data.published !== "boolean") throw Error("Konfigurimi ndryshoi ose nuk u ruajt. Rifresko dhe rishiko ndryshimet.");
  return { message: data.published
    ? `Versioni ${data.revision} u publikua.${data.active ? "" : " Agjenti është joaktiv."} Sjellja duhet provuar.`
    : proposal.mode === "discard" ? "Drafti u hoq. Konfigurimi aktiv mbeti i pandryshuar." : "Drafti u ruajt. Përgjigjet live përdorin ende versionin e publikuar.", path: "agents" };
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
