import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { SetupJourney } from "@/components/setup/journey";
import { getSetupStatus } from "@/lib/setup/status";
export const metadata = { title: "Përgatit biznesin | Agjenti.app" };
export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
  const status = await getSetupStatus(access.business.id);
  return <SetupJourney status={status} slug={slug} />;
}
