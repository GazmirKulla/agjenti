import { createServiceSupabase } from "@/lib/supabase/service";
import { getAppSettings } from "@/lib/platform/settings";
import { basicInstructions, initialInstructions, parseAnswers } from "./model";

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
