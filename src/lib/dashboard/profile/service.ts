import { loadAllowedModules } from "../modules/entitlements";
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
import { moduleRegistry, navigationOrder } from "../modules/registry";

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
  const details = answers.details && typeof answers.details === "object"
    ? answers.details as Record<string, unknown> : null;
  const catalogContext = typeof details?.catalogContext === "string"
    ? details.catalogContext : typeof profile?.catalogContext === "string" ? profile.catalogContext : undefined;

  return {
    businessType,
    offeringTypes,
    selectedUseCases,
    agentCapabilities,
    workflow,
    ...(catalogContext ? { catalogContext } : {}),
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
    return { ...presentationProfile(enabledModules, signals), source: raw.source,
      hiddenModules: asStringArray(raw.hiddenModules).filter(isModuleId) };
  }
  return null;
}

export async function loadDashboardProfile(
  businessId: string,
  options?: { requireExplicit?: boolean },
): Promise<DashboardProfile> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("businesses")
    .select("dashboard_profile")
    .eq("id", businessId)
    .maybeSingle();
  if (error) {
    // Column may not exist yet during rollout — fall back silently.
    if (!options?.requireExplicit && (error.code === "42703" || error.code === "PGRST204")) {
      return applyModuleEntitlements(businessId, legacyDashboardProfile);
    }
    throw new Error("Nuk u ngarkua profili i panelit.");
  }
  const profile = parseDashboardProfile(data?.dashboard_profile);
  return applyModuleEntitlements(businessId, profile ?? legacyDashboardProfile);
}

export async function saveDashboardProfile(
  businessId: string,
  profile: DashboardProfile,
): Promise<DashboardProfile> {
  const db = createServiceSupabase();
  // Persist presentation preferences, never the expanded capability list.
  const permittedProfile = profile;
  await db
    .from("businesses")
    .update({ dashboard_profile: permittedProfile, updated_at: new Date().toISOString() })
    .eq("id", businessId)
    .throwOnError();
  return permittedProfile;
}

export async function persistGeneratedProfile(
  businessId: string,
  answers: Record<string, unknown>,
): Promise<DashboardProfile> {
  const signals = signalsFromOnboardingAnswers(answers);
  const profile = signals
    ? generateDashboardProfile(signals, "generated")
    : legacyDashboardProfile;
  return saveDashboardProfile(businessId, profile);
}

async function applyModuleEntitlements(businessId: string, profile: DashboardProfile) {
  const allowed = new Set(await loadAllowedModules(businessId));
  return { ...profile, enabledModules: [...allowed],
    navigationItems: profile.navigationItems.filter(id => allowed.has(id)),
    mobileNavigationItems: profile.mobileNavigationItems.filter(id => allowed.has(id)) };
}

/** Navigation is presentation only. Successful writes become visible through usage,
 * without mutating business settings or granting any additional permissions. */
export async function loadNavigationProfile(businessId: string): Promise<DashboardProfile> {
  const profile = await loadDashboardProfile(businessId);
  const { data, error } = await createServiceSupabase().rpc("business_used_modules", { p_business: businessId });
  if (error || !Array.isArray(data)) throw new Error("Nuk u ngarkua navigimi i biznesit.");
  const hidden = new Set(profile.hiddenModules ?? []);
  const visible = [...new Set([...profile.navigationItems, ...data.filter(isModuleId)])]
    .filter(id => profile.enabledModules.includes(id) && !hidden.has(id));
  // No dependency between showing two navigation links: execution validates its
  // own prerequisites. The builder is used only for ordering/widgets here.
  const presentation = presentationProfile(visible, profile.signals);
  return { ...presentation, source: profile.source, hiddenModules: profile.hiddenModules,
    enabledModules: profile.enabledModules,
    navigationItems: navigationOrder.filter(id => visible.includes(id) || moduleRegistry[id].core),
    mobileNavigationItems: presentation.mobileNavigationItems.filter(id => !hidden.has(id)) };
}

function presentationProfile(visible: ModuleId[], signals?: DashboardSignals): DashboardProfile {
  const ordered = navigationOrder.filter(id => visible.includes(id) || moduleRegistry[id].core);
  return { ...rebuildProfileFromModules(visible, signals), navigationItems: ordered,
    mobileNavigationItems: ordered.filter(id => moduleRegistry[id].mobilePriority !== undefined)
      .sort((a, b) => moduleRegistry[a].mobilePriority! - moduleRegistry[b].mobilePriority!).slice(0, 4) };
}
