"use server";
import { getSessionUser, listMemberships, requireBusinessAccess } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
import { createStarterWorkspace } from "./starter";
import { onboardingAfterCreate } from "./steps";
import { instructionsFromAnswers } from "./finish";

type OnboardingResult = {
  error?: string;
  destination?: string;
};

/** Onboarding step 1: the business name and, optionally, its Instagram and
 * website. The business is created right away; the sources are only read
 * after the owner confirms them on the next screen. */
export async function createBusiness(form: FormData): Promise<OnboardingResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri për të vazhduar." };
    const access = await listMemberships(user.id);
    if (access.admin) return { destination: homeForAccess(access) };
    const result = await createStarterWorkspace(user.id, {
      name: String(form.get("name") ?? ""),
      instagramUsername: String(form.get("instagramUsername") ?? ""),
      website: String(form.get("website") ?? ""),
    });
    if ("error" in result) return { error: result.error };
    return { destination: onboardingAfterCreate(result.slug, result) };
  } catch {
    return { error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen." };
  }
}

/** End of the onboarding questions (web). */
export async function finishOnboardingProfile(slug: string): Promise<{ ok: boolean }> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false };
    const access = await requireBusinessAccess(user.id, slug);
    if (!access) return { ok: false };
    await instructionsFromAnswers(access.business);
    return { ok: true };
  } catch (error) {
    console.error("[onboarding profile]", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
