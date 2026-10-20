import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { SettingsLayout } from "@/components/settings/layout";

export default async function BusinessSettingsLayout({ params, children }: {
  params: Promise<{ slug: string }>; children: React.ReactNode;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <SettingsLayout slug={access.business.slug} name={access.business.name}>{children}</SettingsLayout>;
}
