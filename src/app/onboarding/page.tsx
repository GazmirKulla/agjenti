import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
import { createServiceSupabase } from "@/lib/supabase/service";
import { emptyAnswers, parseAnswers } from "@/lib/onboarding/model";
import { OnboardingExperience } from "@/components/onboarding/experience";
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
        <div className="onboarding-shell">
          <aside className="onboarding-sidebar">
            <Link href="/" className="onboarding-brand">
              <BrandLogo size={34} />
            </Link>
            <div className="onboarding-welcome">
              <h2>Mirë se erdhe!<br />Le të fillojmë.</h2>
              <p>
                Lidh Instagram-in, organizo produktet dhe kujdesu për klientët
                nga një vend.
              </p>
              <div className="onboarding-art">
                <Icon name="instagram" size={62} />
                <span><Icon name="spark" size={30} /></span>
              </div>
            </div>
            <div className="onboarding-user">
              <span>{user.email}</span>
              <form action={signOut}>
                <button type="submit">Dil nga llogaria</button>
              </form>
            </div>
          </aside>
          <section className="onboarding-body">
            <div className="onboarding-progress">
              <progress max={1} value={0} aria-label="Progresi i konfigurimit" />
              <span>Le të fillojmë</span>
            </div>
            <div className="onboarding-question">
              <span className="onboarding-eyebrow">NJË FILLIM I THJESHTË</span>
              <h1>Krijo hapësirën e biznesit</h1>
              <p>
                Vendos emrin për të krijuar hapësirën. Konfigurimin mund ta plotësosh nga paneli.
              </p>
            </div>
            <BasicWorkspaceForm initialName={typeof data?.answers?.name === "string" ? data.answers.name : ""} />
          </section>
        </div>
      </main>
    );
  let initial = emptyAnswers;
  try {
    if (data)
      initial = parseAnswers(data.answers, false, settings.onboarding_steps);
  } catch {
    /* A malformed old draft can be safely restarted. */
  }
  const { data: audioHistory } = await createServiceSupabase()
    .from("onboarding_audio_attempts")
    .select("id,transcript")
    .eq("user_id", user.id)
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);
  return (
    <OnboardingExperience
      history={(audioHistory ?? []).reverse()}
      initial={initial}
      initialStep={data?.step ?? 0}
      email={user.email || ""}
      enabledSteps={settings.onboarding_steps}
    />
  );
}
