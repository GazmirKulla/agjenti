import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/shell";
import { SourcesStep } from "@/components/onboarding/sources-step";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import "../onboarding.css";

export const metadata = { title: "Ku të gjejnë klientët | Agjenti.app" };

/** Onboarding step 1, right after the business is created: confirm its Instagram and website. */
export default async function OnboardingSourcesPage({ searchParams }: { searchParams: Promise<{ slug?: string; instagram?: string; website?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const access = query.slug ? await requireBusinessAccess(user.id, query.slug) : null;
  if (!access) redirect("/auth/continue");
  return (
    <OnboardingShell step={1} email={user.email}>
      <SourcesStep slug={access.business.slug} initialInstagram={(query.instagram ?? "").slice(0, 80)} initialWebsite={(query.website ?? "").slice(0, 2000)} />
    </OnboardingShell>
  );
}
