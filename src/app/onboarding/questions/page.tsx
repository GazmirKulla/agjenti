import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/shell";
import { QuestionsStep } from "@/components/onboarding/questions-step";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import "../onboarding.css";

export const metadata = { title: "Disa pyetje | Agjenti.app" };

/** Onboarding step 2: the short questions, while the sources are read. */
export default async function OnboardingQuestionsPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const slug = (await searchParams).slug ?? "";
  const access = slug ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
  return (
    <OnboardingShell step={2} email={user.email}>
      <QuestionsStep slug={access.business.slug} />
    </OnboardingShell>
  );
}
