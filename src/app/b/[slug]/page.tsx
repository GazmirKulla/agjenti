import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { OnboardingChecklist } from "@/components/onboarding/checklist";
import { Overview } from "@/components/dashboard/overview";
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
  return (
    <>
      <OnboardingChecklist businessId={access.business.id} slug={slug} />
      <Overview business={access.business} />
    </>
  );
}
