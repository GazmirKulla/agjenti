import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { OnboardingWelcome } from "@/components/onboarding/channels-art";
import { ChannelStep } from "@/components/onboarding/channel-step";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadReadiness } from "@/lib/setup/readiness";
import { signOut } from "@/lib/auth/actions";
import "../onboarding.css";

export const metadata = { title: "Lidh kanalin | Agjenti.app" };

/** Onboarding step 3: connect the channel the agent answers on, then turn the replies on. */
export default async function OnboardingChannelPage({ searchParams }: { searchParams: Promise<{ slug?: string; connected?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const access = query.slug ? await requireBusinessAccess(user.id, query.slug) : null;
  if (!access) redirect("/auth/continue");
  const readiness = await loadReadiness(access.business);
  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <aside className="onboarding-sidebar">
          <Link href="/" className="onboarding-brand"><BrandLogo size={34} /></Link>
          <OnboardingWelcome />
          <div className="onboarding-user">
            <span>{user.email}</span>
            <form action={signOut}><button type="submit">Dil nga llogaria</button></form>
          </div>
        </aside>
        <section className="onboarding-body">
          <ChannelStep slug={access.business.slug} businessId={access.business.id} readiness={readiness} justConnected={query.connected === "1"} />
        </section>
      </div>
    </main>
  );
}
