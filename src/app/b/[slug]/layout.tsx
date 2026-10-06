import { BusinessIntelligencePanel } from "@/components/business-intelligence/panel";
import { SetupJourney } from "@/components/setup/journey";
import { getSetupStatus } from "@/lib/setup/status";
import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
import { getAppSettings } from "@/lib/platform/settings";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { BusinessProfileAnswers } from "@/lib/onboarding/rules";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await listMemberships(user.id);
  const business = access.businesses.find((b) => b.slug === slug);
  if (!business) redirect("/auth/continue");
  const [settings, setup, onboarding, dashboardProfile] = await Promise.all([
    getAppSettings(),
    getSetupStatus(business.id),
    createServiceSupabase()
      .from("business_onboarding")
      .select("answers")
      .eq("business_id", business.id)
      .maybeSingle(),
    loadDashboardProfile(business.id),
  ]);
  const storedAnswers = onboarding.data?.answers;
  const storedProfile =
    storedAnswers &&
    typeof storedAnswers === "object" &&
    !Array.isArray(storedAnswers)
      ? (storedAnswers as Record<string, unknown>).businessProfile
      : null;
  const profile = (() => {
    if (!storedProfile || typeof storedProfile !== "object") return null;
    const config = (storedProfile as BusinessProfileAnswers)
      .recommendedConfiguration;
    if (
      !config ||
      typeof config.workflow !== "string" ||
      !Array.isArray(config.checklist)
    )
      return null;
    return storedProfile as BusinessProfileAnswers;
  })();
  const navigationItems = buildNavigationItems(dashboardProfile, "desktop");
  const mobileNavigationItems = buildNavigationItems(
    dashboardProfile,
    "mobile",
  );
  return (
    <DashboardShell
      name={business.name}
      slug={slug}
      platformAdmin={access.admin}
      businesses={access.businesses}
      email={user.email}
      userName={
        (typeof user.user_metadata?.full_name === "string" &&
          user.user_metadata.full_name) ||
        (typeof user.user_metadata?.name === "string" &&
          user.user_metadata.name) ||
        undefined
      }
      navigationItems={navigationItems}
      mobileNavigationItems={mobileNavigationItems}
    >
      {settings.announcement && (
        <div
          role="status"
          className="panel section-pad mb-6 whitespace-pre-wrap break-words"
        >
          {settings.announcement}
        </div>
      )}
      <SetupJourney
        status={setup}
        slug={slug}
        expanded={settings.checklist_enabled}
        profile={profile}
      />
      <BusinessIntelligencePanel slug={slug} />
      {children}
    </DashboardShell>
  );
}
