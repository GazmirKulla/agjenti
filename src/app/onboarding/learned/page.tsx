import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/shell";
import { LearnedStep } from "@/components/onboarding/learned-step";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import "../onboarding.css";

export const metadata = { title: "Çfarë mësoi Agjenti | Agjenti.app" };

/** Onboarding step 3: confirm what the agent learned from the sources. */
export default async function OnboardingLearnedPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const slug = (await searchParams).slug ?? "";
  const access = slug ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
  return (
    <OnboardingShell step={3} email={user.email}>
      <LearnedStep slug={access.business.slug} />
    </OnboardingShell>
  );
}
