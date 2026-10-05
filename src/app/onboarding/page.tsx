import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
import { createServiceSupabase } from "@/lib/supabase/service";
import { emptyAnswers, parseAnswers } from "@/lib/onboarding/model";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { getAppSettings } from "@/lib/platform/settings";
import { BasicWorkspaceForm } from "@/components/onboarding/basic-workspace";
import { signOut } from "@/lib/auth/actions";
import "./onboarding.css";
export const metadata = { title: "Konfiguro biznesin | Agjenti.app" };
export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?mode=signup");
  const access = await listMemberships(user.id);
  if (access.admin || access.businesses.length) redirect(homeForAccess(access));
  const { data, error } = await createServiceSupabase()
    .from("business_onboarding")
    .select("answers,step,completed_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || data?.completed_at)
    return (
      <main className="onboarding-page">
        <section className="onboarding-unavailable">
          <Link href="/" className="onboarding-brand">
            <BrandLogo size={34} />
          </Link>
          <h1>
            {data?.completed_at
              ? "Hapësira jote kërkon rishikim"
              : "Konfigurimi nuk është i disponueshëm për momentin"}
          </h1>
          <p>
            {data?.completed_at
              ? "Llogaria e ka përfunduar konfigurimin më parë. Kontakto administratorin për të rikthyer qasjen në biznes."
              : "Nuk mundëm të ngarkonim konfigurimin. Provo përsëri ose kontakto administratorin."}
          </p>
          <Link className="btn btn-primary" href="/onboarding">
            Provo përsëri
          </Link>
          <form action={signOut}>
            <button className="btn btn-ghost">Dil nga llogaria</button>
          </form>
        </section>
      </main>
    );
  const settings = await getAppSettings();
  if (!settings.onboarding_enabled)
    return (
      <main className="onboarding-page">
        <section className="onboarding-unavailable">
          <Link href="/" className="onboarding-brand">
            <BrandLogo size={34} />
          </Link>
          <h1>Krijo hapësirën e biznesit</h1>
          <p>
            Vendos emrin e biznesit. Produktet, njohuritë dhe agjentin mund t’i
            konfigurosh nga paneli.
          </p>
          <BasicWorkspaceForm />
          <form action={signOut}>
            <button className="btn btn-ghost">Dil nga llogaria</button>
          </form>
        </section>
      </main>
    );
  let initial = emptyAnswers;
  try {
    if (data) initial = parseAnswers(data.answers);
  } catch {
    /* A malformed old draft can be safely restarted. */
  }
  return (
    <OnboardingWizard
      initial={initial}
      initialStep={data?.step ?? 0}
      email={user.email || ""}
    />
  );
}
