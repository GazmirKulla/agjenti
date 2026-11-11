import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { PageHeading } from "@/components/dashboard/ui";
import { OnboardingLinks } from "@/components/dashboard/onboarding-links";
import { OnboardingDetails } from "@/components/dashboard/onboarding-details";

export default async function AdminOnboardingPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const settings = await getAppSettings();

  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="Onboarding Flow"
        description="Kupto se si përgjigjet e onboarding formojnë profilin e biznesit dhe konfigurimin e Agjentit."
      >
        <Link className="btn btn-ghost" href="/admin/settings">
          Cilësimet
        </Link>
      </PageHeading>
      <OnboardingLinks enabledSteps={settings.onboarding_steps} />
      <OnboardingDetails />
    </>
  );
}
