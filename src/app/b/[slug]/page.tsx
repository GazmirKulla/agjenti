import { AssistantEntry } from "@/components/business-assistant/workspace";
import { Suspense } from "react";
import { DashboardLoading } from "@/components/dashboard/loading";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { Overview } from "@/components/dashboard/overview";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";

export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const dashboardProfile = await loadDashboardProfile(access.business.id);
  return (
    <div className="assistant-first-home">
      <AssistantEntry home/>
      <Suspense fallback={<DashboardLoading />}>
        <Overview
          compact
          business={access.business}
          dashboardProfile={dashboardProfile}
        />
      </Suspense>
    </div>
  );
}
