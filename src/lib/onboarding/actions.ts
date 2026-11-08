"use server";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { homeForAccess } from "@/lib/auth/destination";
import { getAppSettings } from "@/lib/platform/settings";
import { parseAnswers, initialInstructions } from "./model";
import { createStarterWorkspace } from "./starter";
import { persistGeneratedProfile } from "@/lib/dashboard/profile/service";
type OnboardingResult = {
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

async function persistOnboarding(input: unknown, step: number, complete: boolean): Promise<OnboardingResult> {
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
      parsedAnswers = parseAnswers(input, complete, settings.onboarding_steps);
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Kontrollo përgjigjet.",
      };
    }
    const answers = parsedAnswers;
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
        p_instructions: initialInstructions(answers),
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
            answers as unknown as Record<string, unknown>,
          );
        }
      } catch (error) {
        console.error("[dashboard profile]", error);
      }
      return { destination: `/b/${data}` };
    }
    return { saved: true };
  } catch {
    return {
      error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen.",
    };
  }
}

/** Agent mode: the workspace starts from the name and business type; the
 * dashboard agent asks the remaining questions afterwards. */
export async function createAgentWorkspace(form: FormData): Promise<OnboardingResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri për të vazhduar." };
    const access = await listMemberships(user.id);
    if (access.admin || access.businesses.length)
      return { destination: homeForAccess(access) };
    const result = await createStarterWorkspace(user.id, {
      name: String(form.get("name") ?? ""),
      businessType: String(form.get("businessType") ?? ""),
      categoryDescription: String(form.get("categoryDescription") ?? ""),
    });
    if ("error" in result) return { error: result.error };
    return { destination: `/b/${encodeURIComponent(result.slug)}` };
  } catch {
    return { error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen." };
  }
}
