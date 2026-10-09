"use server";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { homeForAccess } from "@/lib/auth/destination";
import { getAppSettings } from "@/lib/platform/settings";
import { emptyAnswers, parseAnswers, initialInstructions, basicInstructions } from "./model";
import { persistGeneratedProfile } from "@/lib/dashboard/profile/service";
export type OnboardingResult = {
  error?: string;
  destination?: string;
  saved?: boolean;
};
export async function saveOnboarding(
  input: unknown,
  step: number,
  complete = false,
): Promise<OnboardingResult> {
  return persistOnboarding(input, step, complete);
}

async function persistOnboarding(input: unknown, step: number, complete: boolean, basic = false): Promise<OnboardingResult> {
  try {
    const user = await getSessionUser();
    if (!user)
      return { error: "Sesioni ka skaduar. Hyr përsëri për të vazhduar." };
    if (
      !Number.isInteger(step) ||
      step < 0 ||
      step > 7 ||
      typeof complete !== "boolean"
    )
      return { error: "Hapi nuk është i vlefshëm." };
    const settings = await getAppSettings();
    let parsedAnswers: ReturnType<typeof parseAnswers>;
    try {
      parsedAnswers = parseAnswers(
        input,
        complete && settings.onboarding_enabled && !basic,
        settings.onboarding_steps,
      );
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Kontrollo përgjigjet.",
      };
    }
    const answers = settings.onboarding_enabled && !basic
      ? parsedAnswers
      : { ...emptyAnswers, name: parsedAnswers.name };
    if (complete && answers.name.length < 2)
      return { error: "Vendos emrin e biznesit (të paktën 2 karaktere)." };
    const access = await listMemberships(user.id);
    if (access.admin || access.businesses.length)
      return { destination: homeForAccess(access) };
    const db = createServiceSupabase();
    const { error } = await db.rpc("save_onboarding_draft", {
      p_user_id: user.id,
      p_answers: answers,
      p_step: step,
    });
    if (error) {
      console.error("[onboarding draft]", error.code);
      return {
        error:
          "Përgjigjet nuk u ruajtën. Provo përsëri; të dhënat janë ende në këtë faqe.",
      };
    }
    if (complete) {
      const { data, error } = await db.rpc("complete_business_onboarding", {
        p_user_id: user.id,
        p_answers: answers,
        p_instructions: settings.onboarding_enabled && !basic
          ? initialInstructions(answers)
          : basicInstructions(answers.name),
      });
      if (error) {
        console.error("[onboarding complete]", error.code);
        return {
          error:
            "Hapësira nuk u krijua. Përgjigjet janë ruajtur; provo përsëri ose kontakto administratorin.",
        };
      }
      if (typeof data !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data))
        return { error: "Nuk u kthye një hapësirë e vlefshme. Provo përsëri." };
      try {
        const { data: business } = await db
          .from("businesses")
          .select("id")
          .eq("slug", data)
          .maybeSingle();
        if (business?.id) {
          await persistGeneratedProfile(
            business.id,
            (basic ? { ...answers, businessType: "other", useCases: ["messages", "support"], agentCapabilities: ["reply_messages", "answer_questions", "handoff"] } : answers) as unknown as Record<string, unknown>,
          );
        }
      } catch (error) {
        console.error("[dashboard profile]", error);
      }
      return { destination: settings.onboarding_enabled && !basic ? `/b/${data}` : `/b/${data}?welcome=1` };
    }
    return { saved: true };
  } catch {
    return {
      error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen.",
    };
  }
}

export async function createBasicWorkspace(form: FormData) {
  return persistOnboarding(
    { ...emptyAnswers, name: String(form.get("name") ?? "") },
    7,
    true,
    true,
  );
}
