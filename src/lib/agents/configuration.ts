import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { AgentConfigurationEffect, AgentConfigurationRead } from "./configuration-contract";

export const agentConfigurationColumns = "id,name,instructions,is_active,updated_at";
export const instructionHash = (instructions: string) => createHash("sha256").update(instructions).digest("hex");

export function configurationRead(agent: { id?: string; name?: string; instructions: string; is_active?: boolean } | null): AgentConfigurationRead {
  return { agentId: agent?.id ?? null, agentName: agent?.name ?? null, active: agent ? agent.is_active ?? null : null,
    instructionHash: agent ? instructionHash(agent.instructions) : null, readAt: new Date().toISOString(),
    instructionSource: agent?.instructions ? "active_agent" : "base",
    fallbackReason: !agent ? "no_active_agent" : !agent.instructions ? "empty_instructions" : null };
}

/** Called only inside the authenticated confirmation boundary; recheck revocation before writing. */
export async function requireAgentConfigurationAccess(businessId: string, userId: string) {
  const db = createServiceSupabase();
  const [member, admin] = await Promise.all([
    db.from("business_users").select("business_id").eq("business_id", businessId).eq("user_id", userId).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (member.error || admin.error || (!member.data && !admin.data)) throw new Error("Nuk ke më qasje për të ndryshuar agjentin në këtë biznes.");
}

/** A post-write observation, never a permanent guarantee or a second activation mechanism. */
export async function observeAgentEffect(businessId: string, targetAgentId: string, instructions: string): Promise<AgentConfigurationEffect> {
  const base: AgentConfigurationEffect = { saved: true, effective: null, status: "unverified", targetAgentId,
    targetActive: null, activeAgentId: null, instructionHash: instructionHash(instructions), checkedAt: new Date().toISOString(), behaviorVerified: false };
  try {
    const { data, error } = await createServiceSupabase().from("ai_agents").select(agentConfigurationColumns)
      .eq("business_id", businessId).or(`id.eq.${targetAgentId},is_active.eq.true`).limit(3);
    if (error || !Array.isArray(data)) return base;
    const target = data.find(row => row.id === targetAgentId);
    const active = data.filter(row => row.is_active === true);
    if (!target || typeof target.instructions !== "string" || typeof target.is_active !== "boolean" || active.length > 1) return base;
    const observed = { ...base, targetActive: target.is_active, activeAgentId: active[0]?.id ?? null };
    if (instructionHash(target.instructions) !== base.instructionHash || active.length === 1 && active[0].id !== targetAgentId)
      return { ...observed, effective: false, status: "superseded" };
    if (!target.is_active) return { ...observed, effective: false, status: "inactive" };
    if (active.length === 1 && target.instructions) return { ...observed, effective: true, status: "effective" };
    return observed;
  } catch { return base; }
}
