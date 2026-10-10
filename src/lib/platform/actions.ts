"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeOnboardingSteps } from "@/lib/onboarding/model";
export async function saveAppSettings(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id)))
    return { error: "Kërkohet qasja e administratorit." };
  const announcement = String(form.get("announcement") ?? "").trim();
  if (announcement.length > 500)
    return { error: "Njoftimi duhet të ketë deri në 500 karaktere." };
  const onboarding_steps = normalizeOnboardingSteps(
    form.getAll("onboarding_steps"),
  );
  const { error } = await createServiceSupabase()
    .from("app_settings")
    .upsert({
      id: true,
      onboarding_mode: form.get("onboarding_mode") === "agent" ? "agent" : "guided",
      onboarding_enabled: form.get("onboarding_enabled") === "on",
      checklist_enabled: form.get("checklist_enabled") === "on",
      onboarding_steps,
      announcement,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
  if (error)
    return {
      error: ["42P01", "PGRST205", "42703"].includes(error.code)
        ? "Duhet aplikuar migrimi i cilësimeve App në databazë përpara ruajtjes."
        : "Cilësimet nuk u ruajtën. Provo përsëri.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      "Cilësimet u ruajtën. Zbatohen në hapjen ose rifreskimin e ardhshëm të faqeve.",
  };
}
