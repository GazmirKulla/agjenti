import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { OnboardingWelcome } from "@/components/onboarding/channels-art";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
import { createServiceSupabase } from "@/lib/supabase/service";
import { emptyAnswers, parseAnswers } from "@/lib/onboarding/model";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { getAppSettings } from "@/lib/platform/settings";
import { AgentWorkspaceForm } from "@/components/onboarding/basic-workspace";
import { signOut } from "@/lib/auth/actions";
import "./onboarding.css";
export const metadata = { title: "Konfiguro biznesin | Agjenti.app" };
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?mode=signup");
  const access = await listMemberships(user.id);
  // People with a business come here only to create another one.
  const creatingAnother = (await searchParams).new === "1";
  if (access.admin || (access.businesses.length && !creatingAnother)) redirect(homeForAccess(access));
  const backHref = access.businesses.length ? homeForAccess(access) : undefined;
  const db = createServiceSupabase();
  // Only the open draft; every completed onboarding belongs to its business.
  const { data: draft, error } = await db
    .from("business_onboarding")
    .select("answers,step")
    .eq("user_id", user.id)
    .is("completed_at", null)
    .maybeSingle();
  if (error)
    return (
      <main className="onboarding-page">
        <section className="onboarding-unavailable">
          <Link href="/" className="onboarding-brand">
            <BrandLogo size={34} />
          </Link>
          <h1>Konfigurimi nuk është i disponueshëm për momentin</h1>
          <p>
            Nuk mundëm të ngarkonim konfigurimin. Provo përsëri ose kontakto
            administratorin.
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
  // Only the mode decides the flow. Agent mode starts from the name and the
  // business type; the dashboard agent asks the remaining questions.
  if (settings.onboarding_mode === "agent")
    return (
      <main className="onboarding-page">
        <div className="onboarding-shell">
          <aside className="onboarding-sidebar">
            <Link href="/" className="onboarding-brand">
              <BrandLogo size={34} />
            </Link>
            <OnboardingWelcome />
            <div className="onboarding-user">
              {backHref && <Link className="onboarding-back-link" href={backHref}>← Kthehu te biznesi</Link>}
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
                Vendos emrin dhe tipin e biznesit për të krijuar hapësirën.
              </p>
            </div>
            <AgentWorkspaceForm
              initialName={typeof draft?.answers?.name === "string" ? draft.answers.name : ""}
              initialType={typeof draft?.answers?.businessType === "string" ? draft.answers.businessType : ""}
            />
          </section>
        </div>
      </main>
    );
  let initial = emptyAnswers;
  try {
    if (draft) {
      // Drafts from the retired audio flow keep their answers, without the
      // pending audio review that only that flow could confirm.
      initial = parseAnswers(draft.answers, false, settings.onboarding_steps);
      delete initial.audioReview;
      delete initial.guidedOnboardingMode;
    }
  } catch {
    /* A malformed old draft can be safely restarted. */
  }
  return (
    <OnboardingWizard
      initial={initial}
      initialStep={draft?.step ?? 0}
      email={user.email || ""}
      enabledSteps={settings.onboarding_steps}
      backHref={backHref}
    />
  );
}
