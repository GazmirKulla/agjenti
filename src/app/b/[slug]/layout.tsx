import { SetupJourney } from "@/components/setup/journey";
import { getSetupStatus } from "@/lib/setup/status";
import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
import { getAppSettings } from "@/lib/platform/settings";
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
  const [settings, setup] = await Promise.all([
    getAppSettings(),
    getSetupStatus(business.id),
  ]);
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
      />
      {children}
    </DashboardShell>
  );
}
