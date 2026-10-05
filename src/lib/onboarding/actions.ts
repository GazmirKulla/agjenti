"use server";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { homeForAccess } from "@/lib/auth/destination";
import { getAppSettings } from "@/lib/platform/settings";
import { emptyAnswers, parseAnswers, initialInstructions } from "./model";
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
    let answers;
    try {
      answers = parseAnswers(
        input,
        complete && settings.onboarding_enabled,
        settings.onboarding_steps,
      );
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Kontrollo përgjigjet.",
      };
    }
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
        p_instructions: settings.onboarding_enabled
          ? initialInstructions(answers)
          : `Je asistenti i biznesit ${answers.name}. Përgjigju në gjuhën e klientit me ton miqësor dhe profesional. Përdor vetëm katalogun dhe njohuritë e biznesit. Mos shpik çmime, stok ose politika. Kur mungon informacioni, kërko ndihmën e stafit.`,
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
      return { destination: `/b/${data}?welcome=1` };
    }
    return { saved: true };
  } catch {
    return {
      error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen.",
    };
  }
}

export async function createBasicWorkspace(form: FormData) {
  return saveOnboarding(
    { ...emptyAnswers, name: String(form.get("name") ?? "") },
    7,
    true,
  );
}
