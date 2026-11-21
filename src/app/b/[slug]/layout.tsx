import { DashboardLanguageProvider } from "@/components/dashboard/language";
import { getDashboardLanguage } from "@/lib/dashboard/language/server";
import { AssistantWorkspaceProvider } from "@/components/business-assistant/workspace";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  listMemberships,
  requireBusinessAccess,
} from "@/lib/tenant/access";
import { AppShell } from "@/components/dashboard/shell";
import { getAppSettings } from "@/lib/platform/settings";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { ownProcessPublished } from "@/lib/orchestration/automatic-process";
import { loadNavigationProfile } from "@/lib/dashboard/profile/service";
import { loadBillingUsage } from "@/lib/billing/service";
import { loadItemSetup } from "@/lib/items/business";
import { channelAttention } from "@/lib/channels/service";
import { loadReadiness } from "@/lib/setup/readiness";
import { BillingUsageNotice } from "@/components/dashboard/billing-usage-notice";
import { isNativeEmbed } from "@/lib/native/embedded";
import { aiUsageSummary, loadAiUsage } from "@/lib/ai/usage-report";
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
  const [settings, dashboardProfile, billingUsage, nativeHost, aiUsage, channelsAttention, readiness] = await Promise.all([
    getAppSettings(),
    loadNavigationProfile(business.id),
    loadBillingUsage(business.id),
    isNativeEmbed(),
    // Tokens are a platform cost statistic: only platform administrators see them.
    access.admin ? loadAiUsage(user.id, business.id, true) : null,
    channelAttention(business.id),
    loadReadiness(business),
  ]);
  const [items, ownProcess] = await Promise.all([
    loadItemSetup(business.id),
    // When it cannot be verified, the editor stays in the menu rather than hiding a process that runs.
    ownProcessPublished(business.id).catch(() => true),
  ]);
  const sectionLabels = { products: items.names.plural };
  // The workflow editor is in the menu only for a business that published a process of its own; for the
  // others it stays under Cilësimet → Mjete të avancuara and Agjenti → Çfarë bën Agjenti.
  const menu = (list: ReturnType<typeof buildNavigationItems>) => ownProcess ? list : list.filter(item => item.id !== "workflows");
  const navigationItems = menu(buildNavigationItems(dashboardProfile, "desktop", sectionLabels));
  return (
    <DashboardLanguageProvider language={language}>
    <AssistantWorkspaceProvider key={`${user.id}:${business.slug}`} userId={user.id} userName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : typeof user.user_metadata?.name === "string" ? user.user_metadata.name : undefined} slug={business.slug} name={business.name} modules={dashboardProfile.navigationItems} external={business.catalog_source === "external"}>
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
      nativeHost={nativeHost}
      aiUsage={aiUsage ? aiUsageSummary(aiUsage) : undefined}
      channelsAttention={channelsAttention}
      readiness={readiness}
    >
      {settings.announcement && (
        <div
          role="status"
          className="panel section-pad mb-6 whitespace-pre-wrap break-words"
        >
          {settings.announcement}
        </div>
      )}
      <BillingUsageNotice slug={business.slug} usage={billingUsage}
        canUpgrade={billingUsage.scope !== "account" || billingUsage.billingUserId === user.id} />
      {children}
        </AppShell>
    </AssistantWorkspaceProvider>
    </DashboardLanguageProvider>
  );
}
