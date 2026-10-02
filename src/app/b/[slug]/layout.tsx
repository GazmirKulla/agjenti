import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { DashboardShell } from "@/components/dashboard/shell";
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
  return (
    <DashboardShell
      name={business.name}
      slug={slug}
      platformAdmin={access.admin}
      businesses={access.businesses}
      email={user.email}
    >
      {children}
    </DashboardShell>
  );
}
