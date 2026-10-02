import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
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
    >
      {children}
    </DashboardShell>
  );
}
