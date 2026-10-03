"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
export async function saveAppSettings(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id)))
    return { error: "Kërkohet qasja e administratorit." };
  const announcement = String(form.get("announcement") ?? "").trim();
  if (announcement.length > 500)
    return { error: "Njoftimi duhet të ketë deri në 500 karaktere." };
  const { error } = await createServiceSupabase()
    .from("app_settings")
    .upsert({
      id: true,
      onboarding_enabled: form.get("onboarding_enabled") === "on",
      checklist_enabled: form.get("checklist_enabled") === "on",
      announcement,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
  if (error)
    return {
      error: ["42P01", "PGRST205"].includes(error.code)
        ? "Duhet aplikuar migrimi i cilësimeve App në databazë përpara ruajtjes."
        : "Cilësimet nuk u ruajtën. Provo përsëri.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      "Cilësimet u ruajtën. Zbatohen në hapjen ose rifreskimin e ardhshëm të faqeve.",
  };
}
