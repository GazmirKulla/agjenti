import { createServiceSupabase } from "@/lib/supabase/service";
import { isModuleId } from "../modules/dependencies";
import type {
  DashboardProfile,
  DashboardSignals,
  ModuleId,
} from "../modules/types";
import {
  generateDashboardProfile,
  rebuildProfileFromModules,
} from "./generate";
import { legacyDashboardProfile } from "./legacy";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function signalsFromOnboardingAnswers(
  answers: Record<string, unknown> | null | undefined,
): DashboardSignals | null {
  if (!answers || typeof answers !== "object") return null;
  const profile =
    answers.businessProfile &&
    typeof answers.businessProfile === "object" &&
    !Array.isArray(answers.businessProfile)
      ? (answers.businessProfile as Record<string, unknown>)
      : null;
  const businessType =
    (typeof answers.businessType === "string" && answers.businessType) ||
    (typeof profile?.businessType === "string" && profile.businessType) ||
    "";
  if (!businessType) return null;

  const offeringTypes = asStringArray(
    Array.isArray(answers.offeringTypes) && answers.offeringTypes.length
      ? answers.offeringTypes
      : profile?.offeringTypes,
  );
  const selectedUseCases = asStringArray(
    answers.useCases ??
      answers.selectedUseCases ??
      profile?.selectedUseCases,
  );
  const agentCapabilities = asStringArray(
    answers.agentCapabilities ?? profile?.agentCapabilities,
  );
  const recommended =
    profile?.recommendedConfiguration &&
    typeof profile.recommendedConfiguration === "object"
      ? (profile.recommendedConfiguration as Record<string, unknown>)
      : null;
  const workflow =
    typeof recommended?.workflow === "string" ? recommended.workflow : undefined;
  const teamSize =
    typeof answers.teamSize === "string" ? answers.teamSize : undefined;

  return {
    businessType,
    offeringTypes,
    selectedUseCases,
    agentCapabilities,
    workflow,
    teamSize,
  };
}

export function parseDashboardProfile(value: unknown): DashboardProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.source !== "string") return null;
  if (!Array.isArray(raw.enabledModules)) return null;
  const enabledModules = raw.enabledModules.filter(
    (item): item is ModuleId => typeof item === "string" && isModuleId(item),
  );
  if (!enabledModules.length) return null;
  if (raw.source === "legacy") return legacyDashboardProfile;
  if (raw.source === "manual" || raw.source === "generated") {
    const signals =
      raw.signals && typeof raw.signals === "object"
        ? (raw.signals as DashboardSignals)
        : undefined;
    return rebuildProfileFromModules(enabledModules, signals);
  }
  return null;
}

export async function loadDashboardProfile(
  businessId: string,
): Promise<DashboardProfile> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("businesses")
    .select("dashboard_profile")
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    // Column may not exist yet during rollout — fall back silently.
    if (error.code === "42703" || error.code === "PGRST204") {
      return legacyDashboardProfile;
    }
    throw new Error("Nuk u ngarkua profili i panelit.");
  }
  return parseDashboardProfile(data?.dashboard_profile) ?? legacyDashboardProfile;
}

export async function saveDashboardProfile(
  businessId: string,
  profile: DashboardProfile,
): Promise<void> {
  const db = createServiceSupabase();
  await db
    .from("businesses")
    .update({ dashboard_profile: profile, updated_at: new Date().toISOString() })
    .eq("id", businessId)
    .throwOnError();
}

export async function persistGeneratedProfile(
  businessId: string,
  answers: Record<string, unknown>,
): Promise<DashboardProfile> {
  const signals = signalsFromOnboardingAnswers(answers);
  const profile = signals
    ? generateDashboardProfile(signals, "generated")
    : legacyDashboardProfile;
  await saveDashboardProfile(businessId, profile);
  return profile;
}
