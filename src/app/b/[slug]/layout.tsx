import { DashboardLanguageProvider } from "@/components/dashboard/language";
import { getDashboardLanguage } from "@/lib/dashboard/language/server";
import { AssistantWorkspaceProvider } from "@/components/business-assistant/workspace";
import { BusinessIntelligencePanel } from "@/components/business-intelligence/panel";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  listMemberships,
  requireBusinessAccess,
} from "@/lib/tenant/access";
import { AppShell } from "@/components/dashboard/shell";
import { getAppSettings } from "@/lib/platform/settings";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { loadBillingUsage } from "@/lib/billing/service";
import { BillingUsageNotice } from "@/components/dashboard/billing-usage-notice";
export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const language = await getDashboardLanguage();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await listMemberships(user.id);
  const business = (await requireBusinessAccess(user.id, slug))?.business;
  if (!business) redirect("/auth/continue");
  const [settings, dashboardProfile, billingUsage] = await Promise.all([
    getAppSettings(),
    loadDashboardProfile(business.id),
    loadBillingUsage(business.id),
  ]);
  const navigationItems = buildNavigationItems(dashboardProfile, "desktop");
  const mobileNavigationItems = buildNavigationItems(
    dashboardProfile,
    "mobile",
  );
  return (
    <DashboardLanguageProvider language={language}>
    <AssistantWorkspaceProvider key={`${user.id}:${business.slug}`} userId={user.id} userName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : undefined} slug={business.slug} name={business.name} modules={dashboardProfile.enabledModules} external={business.catalog_source === "external"}>
        <AppShell
      name={business.name}
      slug={business.slug}
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
      <BillingUsageNotice slug={business.slug} usage={billingUsage} />
      <BusinessIntelligencePanel slug={business.slug} />
      {children}
        </AppShell>
    </AssistantWorkspaceProvider>
    </DashboardLanguageProvider>
  );
}
