import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

/** What the customer agent does by itself, set by the business (businesses.agent_behavior). */
export type Escalation = "handoff" | "notify" | "off";
export type AgentBehavior = { voice: boolean; escalation: Escalation };
export const defaultAgentBehavior: AgentBehavior = { voice: true, escalation: "handoff" };

export function readAgentBehavior(raw: unknown): AgentBehavior {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    voice: typeof value.voice === "boolean" ? value.voice : defaultAgentBehavior.voice,
    escalation: value.escalation === "notify" || value.escalation === "off" || value.escalation === "handoff" ? value.escalation : defaultAgentBehavior.escalation,
  };
}

/** The stored settings; the defaults when they cannot be read (reading voice and handing off never block a reply). */
export async function loadAgentBehavior(businessId: string): Promise<AgentBehavior> {
  const { data, error } = await createServiceSupabase().from("businesses").select("agent_behavior").eq("id", businessId).maybeSingle();
  return error ? defaultAgentBehavior : readAgentBehavior(data?.agent_behavior);
}

/** Owner or platform administrator; only the two settings, each with its allowed values. */
export async function storeAgentBehavior(businessId: string, userId: string, patch: Partial<Record<keyof AgentBehavior, unknown>>) {
  const db = createServiceSupabase();
  const { data: member } = await db.from("business_users").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (member?.role !== "owner" && !(await isPlatformAdmin(userId))) return { error: "Vetëm pronari mund ta ndryshojë këtë." };
  if (patch.voice !== undefined && typeof patch.voice !== "boolean") return { error: "Zgjedhja për mesazhet zanore nuk është e vlefshme." };
  if (patch.escalation !== undefined && !["handoff", "notify", "off"].includes(String(patch.escalation))) return { error: "Zgjedhja për klientin e pakënaqur nuk është e vlefshme." };
  const current = await loadAgentBehavior(businessId);
  const next: AgentBehavior = { ...current, ...(patch.voice !== undefined ? { voice: patch.voice as boolean } : {}), ...(patch.escalation !== undefined ? { escalation: patch.escalation as Escalation } : {}) };
  const { error } = await db.from("businesses").update({ agent_behavior: next, updated_at: new Date().toISOString() }).eq("id", businessId);
  return error ? { error: "Cilësimi nuk u ruajt. Provo përsëri." } : { behavior: next };
}
