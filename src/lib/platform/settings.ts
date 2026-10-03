import { cache } from "react";
import { createServiceSupabase } from "@/lib/supabase/service";
export const defaultAppSettings = {
  onboarding_enabled: true,
  checklist_enabled: true,
  announcement: "",
};
export type AppSettings = typeof defaultAppSettings;
export const getAppSettings = cache(
  async function getAppSettings(): Promise<AppSettings> {
    const { data, error } = await createServiceSupabase()
      .from("app_settings")
      .select("onboarding_enabled,checklist_enabled,announcement")
      .eq("id", true)
      .maybeSingle();
    // Preserve existing behavior while the migration is being deployed.
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code))
        return { ...defaultAppSettings };
      throw new Error("Nuk u ngarkuan cilësimet e aplikacionit.");
    }
    return data ?? { ...defaultAppSettings };
  },
);
