import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) redirect("/app");
  return (
    <DashboardShell name="Platform Admin" admin>
      {children}
    </DashboardShell>
  );
}
