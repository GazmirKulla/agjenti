import { createServiceSupabase } from "@/lib/supabase/service";
import { getAppSettings } from "@/lib/platform/settings";
import { basicInstructions, initialInstructions, parseAnswers, type Answers } from "./model";

/** End of the onboarding questions: an agent still on the starter text gets
 * instructions from the answers. Not while a scan proposal is on its way;
 * its review sets the instructions and needs them unchanged until then. */
export async function instructionsFromAnswers(business: { id: string; name: string }) {
  const db = createServiceSupabase();
  const [{ data: row }, { data: agent }, { data: jobs }, settings] = await Promise.all([
    db.from("business_onboarding").select("answers").eq("business_id", business.id).maybeSingle(),
    db.from("ai_agents").select("id,instructions").eq("business_id", business.id).order("created_at").limit(1).maybeSingle(),
    db.from("business_discovery_jobs").select("status,checkpoint").eq("business_id", business.id).not("input->>review", "is", null),
    getAppSettings(),
  ]);
  if (!row || !agent || agent.instructions !== basicInstructions(business.name)) return false;
  const proposal = (jobs ?? []).some((job) => ["queued", "running"].includes(job.status) || job.checkpoint?.review?.status === "pending");
  if (proposal) return false;
  const answers = parseAnswers(row.answers, false, settings.onboarding_steps);
  await db.from("ai_agents").update({ instructions: initialInstructions(answers), updated_at: new Date().toISOString() })
    .eq("id", agent.id).eq("instructions", agent.instructions);
  return true;
}

/** After an answer about the agent (what it does, when it hands over): the
 * instructions follow it while they are still the generated ones. Instructions
 * the owner wrote are left as they are ("kept"). */
export async function refreshAgentInstructions(businessId: string, before: Answers, after: Answers): Promise<"updated" | "kept" | "none"> {
  const db = createServiceSupabase();
  const [{ data: business }, { data: agent }] = await Promise.all([
    db.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    db.from("ai_agents").select("id,instructions").eq("business_id", businessId).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!business || !agent) return "none";
  const generated = [basicInstructions(business.name), initialInstructions(before)];
  if (!generated.includes(agent.instructions)) return "kept";
  const next = initialInstructions(after);
  if (next === agent.instructions) return "updated";
  const { error } = await db.from("ai_agents").update({ instructions: next, updated_at: new Date().toISOString() })
    .eq("id", agent.id).eq("instructions", agent.instructions);
  return error ? "kept" : "updated";
}
