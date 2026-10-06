import { DashboardShell } from "@/components/dashboard/shell";
import { buildAdminNavigation } from "@/lib/dashboard/navigation/builder";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await listMemberships(user.id);
  if (!access.admin) redirect("/auth/continue");
  return (
    <DashboardShell
      name="Platform Admin"
      admin
      platformAdmin
      businesses={access.businesses}
      email={user.email}
      userName={
        (typeof user.user_metadata?.full_name === "string" &&
          user.user_metadata.full_name) ||
        (typeof user.user_metadata?.name === "string" &&
          user.user_metadata.name) ||
        undefined
      }
      navigationItems={buildAdminNavigation("desktop")}
      mobileNavigationItems={buildAdminNavigation("mobile")}
    >
      {children}
    </DashboardShell>
  );
}
