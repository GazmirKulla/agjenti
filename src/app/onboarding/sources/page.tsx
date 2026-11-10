import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { OnboardingWelcome } from "@/components/onboarding/channels-art";
import { SourcesStep } from "@/components/onboarding/sources-step";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { signOut } from "@/lib/auth/actions";
import "../onboarding.css";

export const metadata = { title: "Nga ku të mësojë Agjenti | Agjenti.app" };

/** Onboarding step 2, right after the business is created. */
export default async function OnboardingSourcesPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const slug = (await searchParams).slug ?? "";
  const access = slug ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
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
          <SourcesStep slug={access.business.slug} />
        </section>
      </div>
    </main>
  );
}
