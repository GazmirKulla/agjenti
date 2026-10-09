import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { DiscoverySetup } from "@/components/setup/discovery";
export const metadata = { title: "Burime | Agjenti.app" };
export default async function SourcesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
  return <DiscoverySetup slug={slug} businessId={access.business.id} />;
}
