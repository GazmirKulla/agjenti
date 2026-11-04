import { createServiceSupabase } from "@/lib/supabase/service";
import { randomUUID } from "node:crypto";
import { uuid } from "@/lib/calendar/model";
export async function prepareManagedAgent(businessId: string, input: Record<string, unknown>) {
  const db = createServiceSupabase();
  if (input.id !== undefined && !uuid(input.id)) throw Error("Zgjidh një agjent të vlefshëm.");
  const loaded = await db.from("ai_agents").select("id,name,instructions,is_active,updated_at").eq("business_id", businessId).order("id");
  if (loaded.error) throw Error("Agjentët nuk u lexuan.");
  const before = input.id ? loaded.data?.find(agent => agent.id === input.id) : null;
  if (input.id && !before) throw Error("Agjenti nuk u gjet në këtë biznes.");
  const values = { name: before?.name ?? "", instructions: before?.instructions ?? "", is_active: before?.is_active ?? false, ...input };
  if (typeof values.name !== "string" || !values.name.trim() || values.name.length > 120 || typeof values.instructions !== "string" || !values.instructions.trim() || values.instructions.length > 8000 || typeof values.is_active !== "boolean") throw Error("Plotëso emrin, udhëzimet dhe gjendjen e agjentit.");
  return { id: before?.id ?? randomUUID(), before: before ?? null,
    active: (loaded.data ?? []).filter(agent => agent.is_active).map(agent => agent.id),
    activeNames: (loaded.data ?? []).filter(agent => agent.is_active).map(agent => agent.name),
    values: { name: values.name.trim(), instructions: values.instructions.trim(), is_active: values.is_active } };
}
export async function saveManagedAgent(businessId: string, userId: string, proposal: Awaited<ReturnType<typeof prepareManagedAgent>>) {
  const result = await createServiceSupabase().rpc("save_managed_agent", { p_business: businessId, p_user: userId,
    p_id: proposal.id, p_before: proposal.before, p_active: proposal.active, p_values: proposal.values });
  if (result.error || result.data !== proposal.id) throw Error(result.error?.message === "agent_limit_reached" ? "U arrit limiti i agjentëve të biznesit." : "Agjenti ndryshoi ose nuk u ruajt. Rishqyrto propozimin.");
  return { message: "Konfigurimi i agjentit u ruajt.", path: "agents" };
}
