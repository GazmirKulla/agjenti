import { createServiceSupabase } from "@/lib/supabase/service";
import { getAppSettings } from "@/lib/platform/settings";
import { refreshGeneratedProfile } from "@/lib/dashboard/profile/service";
import { syncProfileKnowledge } from "@/lib/knowledge/profile-knowledge";
import { parseAnswers, type Answers } from "./model";
import {
  applyContinuationAnswer,
  changesDashboardSignals,
  continuationOverview,
  ContinuationError,
  AGENT_FIELDS,
} from "./continuation";
import { refreshAgentInstructions } from "./finish";

export type ContinuationView = ReturnType<typeof continuationOverview> & {
  profileChanged?: boolean;
  /** For an answer about the agent: whether its instructions followed it. */
  instructions?: "updated" | "kept" | "none";
};

async function loadRow(businessId: string) {
  const { data, error } = await createServiceSupabase()
    .from("business_onboarding")
    .select("answers,updated_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("onboarding_unavailable");
  return data;
}

/** Null when this business never went through onboarding. */
export async function loadContinuation(businessId: string): Promise<ContinuationView | null> {
  const settings = await getAppSettings();
  const row = await loadRow(businessId);
  if (!row) return null;
  let answers: Answers;
  try {
    answers = parseAnswers(row.answers, false, settings.onboarding_steps);
  } catch {
    return null;
  }
  return continuationOverview(answers, settings.onboarding_steps);
}

export async function answerContinuation(
  businessId: string,
  field: unknown,
  answer: unknown,
): Promise<ContinuationView> {
  const settings = await getAppSettings();
  const row = await loadRow(businessId);
  if (!row) throw new ContinuationError("Ky biznes nuk ka pyetje konfigurimi.", 404);
  let current: Answers;
  try {
    current = parseAnswers(row.answers, false, settings.onboarding_steps);
  } catch {
    throw new ContinuationError("Ky biznes nuk ka pyetje konfigurimi.", 404);
  }
  const next = applyContinuationAnswer(current, settings.onboarding_steps, field, answer);
  // Optimistic write: a second tab or device answering at the same time must
  // not silently overwrite the other answer.
  const { data, error } = await createServiceSupabase()
    .from("business_onboarding")
    .update({ answers: next, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("updated_at", row.updated_at)
    .select("business_id");
  if (error) throw new Error("onboarding_save_failed");
  if (!data?.length)
    throw new ContinuationError("Përgjigjet ndryshuan në një dritare tjetër. Rifresko panelin.", 409);
  // What the owner tells about the business is kept in Knowledge, where the agent reads it.
  try { await syncProfileKnowledge(businessId, next.details); }
  catch (error) { console.error("[onboarding continuation knowledge]", error); }
  let profileChanged = false;
  if (changesDashboardSignals(current, next)) {
    try {
      profileChanged = await refreshGeneratedProfile(businessId, next as unknown as Record<string, unknown>);
    } catch (error) {
      // The answer is saved; the module profile can be regenerated on a later answer.
      console.error("[onboarding continuation profile]", error);
    }
  }
  let instructions: ContinuationView["instructions"];
  if (typeof field === "string" && AGENT_FIELDS.has(field)) {
    try { instructions = await refreshAgentInstructions(businessId, current, next); }
    catch (error) { console.error("[onboarding continuation instructions]", error); }
  }
  return { ...continuationOverview(next, settings.onboarding_steps), profileChanged, instructions };
}
