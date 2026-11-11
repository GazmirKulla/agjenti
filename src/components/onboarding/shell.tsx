import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { OnboardingWelcome } from "@/components/onboarding/channels-art";
import { signOut } from "@/lib/auth/actions";
import { ONBOARDING_STEPS } from "@/lib/onboarding/steps";

/** The frame of every onboarding page: the four steps on the side, the
 * current one in the body. */
export function OnboardingShell({ step, email, backHref, children }: {
  step: 1 | 2 | 3 | 4;
  email: string | undefined;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <aside className="onboarding-sidebar">
          <Link href="/" className="onboarding-brand"><BrandLogo size={34} /></Link>
          {step === 1 && <OnboardingWelcome />}
          <ol aria-label="Hapat e konfigurimit">
            {ONBOARDING_STEPS.map((label, index) => (
              <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step > index + 1 ? "is-done" : ""}>
                <span>{step > index + 1 ? "✓" : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <div className="onboarding-user">
            {backHref && <Link className="onboarding-back-link" href={backHref}>← Kthehu te biznesi</Link>}
            <span>{email}</span>
            <form action={signOut}><button type="submit">Dil nga llogaria</button></form>
          </div>
        </aside>
        <section className="onboarding-body">
          <div className="onboarding-progress">
            <progress max={ONBOARDING_STEPS.length} value={step} aria-label="Progresi i konfigurimit" />
            <span>Hapi {step} nga {ONBOARDING_STEPS.length} · {ONBOARDING_STEPS[step - 1]}</span>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
