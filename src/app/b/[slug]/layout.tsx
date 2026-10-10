import { AssistantWorkspaceProvider } from "@/components/business-assistant/workspace";
import { BusinessIntelligencePanel } from "@/components/business-intelligence/panel";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  listMemberships,
  requireBusinessAccess,
} from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
import { getAppSettings } from "@/lib/platform/settings";
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
  const business = (await requireBusinessAccess(user.id, slug))?.business;
  if (!business) redirect("/auth/continue");
  const [settings, dashboardProfile] = await Promise.all([
    getAppSettings(),
    loadDashboardProfile(business.id),
  ]);
  const navigationItems = buildNavigationItems(dashboardProfile, "desktop");
  const mobileNavigationItems = buildNavigationItems(
    dashboardProfile,
    "mobile",
  );
  return (
    <AssistantWorkspaceProvider key={business.slug} slug={business.slug} name={business.name} modules={dashboardProfile.enabledModules} external={business.catalog_source === "external"}>
    <DashboardShell
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
      <BusinessIntelligencePanel slug={business.slug} />
      {children}
    </DashboardShell>
    </AssistantWorkspaceProvider>
  );
}
