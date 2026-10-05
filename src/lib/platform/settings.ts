import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  allQuestionKeys,
  normalizeOnboardingSteps,
  type AnswerKey,
} from "@/lib/onboarding/model";
export const defaultAppSettings = {
  onboarding_enabled: true,
  checklist_enabled: true,
  announcement: "",
  onboarding_steps: [...allQuestionKeys] as AnswerKey[],
};
export type AppSettings = typeof defaultAppSettings;
function normalizeSettings(data: Record<string, unknown> | null): AppSettings {
  if (!data) return { ...defaultAppSettings };
  return {
    onboarding_enabled:
      typeof data.onboarding_enabled === "boolean"
        ? data.onboarding_enabled
        : defaultAppSettings.onboarding_enabled,
    checklist_enabled:
      typeof data.checklist_enabled === "boolean"
        ? data.checklist_enabled
        : defaultAppSettings.checklist_enabled,
    announcement:
      typeof data.announcement === "string"
        ? data.announcement
        : defaultAppSettings.announcement,
    onboarding_steps: normalizeOnboardingSteps(
      data.onboarding_steps ?? defaultAppSettings.onboarding_steps,
    ),
  };
}
export const getAppSettings = cache(
  async function getAppSettings(): Promise<AppSettings> {
    const { data, error } = await createServiceSupabase()
      .from("app_settings")
      .select(
        "onboarding_enabled,checklist_enabled,announcement,onboarding_steps",
      )
      .eq("id", true)
      .maybeSingle();
    // Preserve existing behavior while the migration is being deployed.
    if (error) {
      if (["42P01", "PGRST205", "42703"].includes(error.code))
        return { ...defaultAppSettings };
      throw new Error("Nuk u ngarkuan cilësimet e aplikacionit.");
    }
    return normalizeSettings(data);
  },
);
