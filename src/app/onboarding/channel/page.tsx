import { redirect } from "next/navigation";
import { ChannelStep } from "@/components/onboarding/channel-step";
import { OnboardingShell } from "@/components/onboarding/shell";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadReadiness } from "@/lib/setup/readiness";
import "../onboarding.css";

export const metadata = { title: "Lidh kanalin | Agjenti.app" };

/** Onboarding step 4: connect the channel the agent answers on, then turn the replies on. */
export default async function OnboardingChannelPage({ searchParams }: { searchParams: Promise<{ slug?: string; connected?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const access = query.slug ? await requireBusinessAccess(user.id, query.slug) : null;
  if (!access) redirect("/auth/continue");
  const readiness = await loadReadiness(access.business);
  return (
    <OnboardingShell step={4} email={user.email}>
      <ChannelStep slug={access.business.slug} businessId={access.business.id} readiness={readiness} justConnected={query.connected === "1"} />
    </OnboardingShell>
  );
}
