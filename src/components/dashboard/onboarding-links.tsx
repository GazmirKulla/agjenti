import {
  onboardingLinks,
  profileLinkRows,
  questionLabel,
  wizardSteps,
} from "@/lib/onboarding/map";
import type { AnswerKey } from "@/lib/onboarding/model";

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="onboarding-chip">{children}</span>;
}

function StepBadge({
  keyName,
  enabled,
}: {
  keyName: AnswerKey;
  enabled: boolean;
}) {
  return (
    <span
      className={`onboarding-step-badge${enabled ? "" : " is-off"}`}
      title={enabled ? "Aktiv në App" : "I fikur në App"}
    >
      {questionLabel(keyName)}
      <small>{keyName}</small>
    </span>
  );
}

export function OnboardingLinks({
  enabledSteps,
}: {
  enabledSteps: readonly AnswerKey[];
}) {
  const enabled = new Set(enabledSteps);
  const steps = wizardSteps();
  const links = onboardingLinks();
  const profiles = profileLinkRows();

  return (
    <div className="onboarding-map grid gap-6">
      <section className="panel section-pad">
        <h2 className="text-lg mb-2">Renditja e hapave</h2>
        <p className="muted-copy mb-4">
          Pyetjet që shfaqen në wizard, sipas rendit. Hapësirat e fikura në App
          mbeten në hartë, por nuk shfaqen përdoruesit.
        </p>
        <ol className="onboarding-flow">
          {steps.map((step) => (
            <li key={step.key}>
              <span className="onboarding-flow-index">{step.index}</span>
              <div>
                <strong>{step.label}</strong>
                <p className="muted-copy">
                  {step.title}
                  {step.optional ? " · opsionale" : ""}
                </p>
              </div>
              <span
                className={`status-badge status-${enabled.has(step.key) ? "connected" : "paused"}`}
              >
                {enabled.has(step.key) ? "Aktiv" : "I fikur"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel section-pad">
        <h2 className="text-lg mb-2">Lidhjet midis hapave</h2>
        <p className="muted-copy mb-4">
          Si kushtëzon një përgjigje opsionet e hapave të mëvonshëm.
        </p>
        <ul className="onboarding-link-list">
          {links.map((link) => (
            <li key={`${link.from}-${link.to}`}>
              <div className="onboarding-link-edge">
                <StepBadge
                  keyName={link.from}
                  enabled={enabled.has(link.from)}
                />
                <span className="onboarding-link-arrow" aria-hidden>
                  →
                </span>
                <StepBadge keyName={link.to} enabled={enabled.has(link.to)} />
              </div>
              <p className="muted-copy">{link.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel section-pad">
        <h2 className="text-lg mb-2">Lidhjet sipas llojit të biznesit</h2>
        <p className="muted-copy mb-4">
          Për çdo lloj biznesi: ofertat e lejuara, qëllimet, dhe aftësitë që
          lidhen me çdo qëllim.
        </p>
        <div className="onboarding-profile-grid">
          {profiles.map((profile) => (
            <article key={profile.businessType} className="detail-block">
              <h3>
                {profile.label}
                <small>{profile.businessType}</small>
              </h3>
              <div className="onboarding-profile-section">
                <p className="form-label">Oferta (productType)</p>
                <div className="onboarding-chip-row">
                  {profile.offerings.map(([value, label]) => (
                    <Chip key={value}>{label}</Chip>
                  ))}
                </div>
              </div>
              <div className="onboarding-profile-section">
                <p className="form-label">Qëllimet (useCases)</p>
                <div className="onboarding-chip-row">
                  {profile.useCases.map(([value, label]) => (
                    <Chip key={value}>{label}</Chip>
                  ))}
                </div>
              </div>
              <div className="onboarding-profile-section">
                <p className="form-label">Qëllim → aftësi (aiMode)</p>
                <ul className="onboarding-capability-links">
                  {profile.useCaseCapabilityLinks.map((row) => (
                    <li key={row.useCase[0]}>
                      <strong>{row.useCase[1]}</strong>
                      <div className="onboarding-chip-row">
                        {row.capabilities.map(([value, label]) => (
                          <Chip key={value}>{label}</Chip>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
