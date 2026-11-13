"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeOnboardingSteps } from "@/lib/onboarding/model";
import { clearModelChoiceCache, loadModelTiers, MODEL_PATTERN, verifyModel } from "@/lib/ai/model-choice";
import { MODEL_ROLES } from "@/lib/agents/model";
import { normalizeLearningSettings } from "@/lib/conversation-learning/settings";
export async function saveAppSettings(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id)))
    return { error: "Kërkohet qasja e administratorit." };
  const announcement = String(form.get("announcement") ?? "").trim();
  if (announcement.length > 500)
    return { error: "Njoftimi duhet të ketë deri në 500 karaktere." };
  const { tiers } = await loadModelTiers();
  const modelTier = String(form.get("model_tier") ?? "");
  if (modelTier && !tiers.some((tier) => tier.id === modelTier)) return { error: "Zgjidh një grup modelesh ekzistues." };
  const onboarding_steps = normalizeOnboardingSteps(
    form.getAll("onboarding_steps"),
  );
  const { error } = await createServiceSupabase()
    .from("app_settings")
    .upsert({
      id: true,
      onboarding_enabled: form.get("onboarding_enabled") === "on",
      checklist_enabled: form.get("checklist_enabled") === "on",
      onboarding_steps,
      announcement,
      ...(modelTier ? { model_tier: modelTier } : {}),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
  if (error)
    return {
      error: ["42P01", "PGRST205", "42703"].includes(error.code)
        ? "Duhet aplikuar migrimi i cilësimeve App në databazë përpara ruajtjes."
        : "Cilësimet nuk u ruajtën. Provo përsëri.",
    };
  clearModelChoiceCache();
  revalidatePath("/", "layout");
  return {
    success:
      "Cilësimet u ruajtën. Zbatohen në hapjen ose rifreskimin e ardhshëm të faqeve.",
  };
}

/** Saves the models of every group. Only changed models are checked with OpenAI. */
export async function saveModelTiers(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id)))
    return { error: "Kërkohet qasja e administratorit." };
  clearModelChoiceCache();
  const { tiers } = await loadModelTiers();
  const updates = [];
  for (const tier of tiers) {
    const label = String(form.get(`${tier.id}:label`) ?? tier.label).trim();
    if (!label || label.length > 40) return { error: "Emri i grupit duhet të ketë 1–40 karaktere." };
    const row: Record<string, string | null> = { label };
    for (const role of MODEL_ROLES) {
      const value = String(form.get(`${tier.id}:${role}`) ?? "").trim();
      if (value && !MODEL_PATTERN.test(value)) return { error: `"${value}" nuk është emër i vlefshëm modeli.` };
      row[`${role}_model`] = value || null;
    }
    updates.push({ id: tier.id, row, changed: MODEL_ROLES.flatMap((role) => {
      const value = row[`${role}_model`];
      return value && value !== tier[`${role}_model`] ? [value] : [];
    }) });
  }
  for (const model of [...new Set(updates.flatMap((u) => u.changed))]) {
    const problem = await verifyModel(model);
    if (problem) return { error: problem };
  }
  const db = createServiceSupabase();
  for (const update of updates) {
    const { error } = await db.from("model_tiers").update({ ...update.row, updated_at: new Date().toISOString() }).eq("id", update.id);
    if (error)
      return { error: ["42P01", "PGRST205"].includes(error.code) ? "Duhet aplikuar migrimi i grupeve të modeleve." : "Grupet nuk u ruajtën. Provo përsëri." };
  }
  const platformTier = String(form.get("model_tier") ?? "");
  if (platformTier) {
    if (!tiers.some((tier) => tier.id === platformTier)) return { error: "Zgjidh një grup modelesh ekzistues." };
    const { error } = await db.from("app_settings").update({ model_tier: platformTier, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return { error: "Grupi i platformës nuk u ruajt. Provo përsëri." };
  }
  clearModelChoiceCache();
  revalidatePath("/admin/settings");
  revalidatePath("/admin/businesses");
  return { success: "Modelet u ruajtën. Vlejnë menjëherë për thirrjet e reja." };
}

/** Saves the platform limits of "Mëso nga bisedat". */
export async function saveConversationLearning(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) return { error: "Kërkohet qasja e administratorit." };
  const conversation_learning = normalizeLearningSettings({
    enabled: form.get("learning_enabled") === "on",
    instagram_history: form.get("learning_instagram_history") === "on",
    min_conversations: form.get("learning_min_conversations"),
    messages_per_conversation: form.get("learning_messages_per_conversation"),
    max_conversations: form.get("learning_max_conversations"),
    lookback_days: form.get("learning_lookback_days"),
  });
  const { error } = await createServiceSupabase().from("app_settings")
    .update({ conversation_learning, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return {
    error: ["42P01", "PGRST205", "42703"].includes(error.code)
      ? "Duhet aplikuar migrimi i mësimit nga bisedat në databazë përpara ruajtjes."
      : "Cilësimet nuk u ruajtën. Provo përsëri.",
  };
  revalidatePath("/admin/settings");
  return { success: "Cilësimet e mësimit nga bisedat u ruajtën." };
}
