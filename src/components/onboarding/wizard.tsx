"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";
import { signOut } from "@/lib/auth/actions";
import { saveOnboarding } from "@/lib/onboarding/actions";
import { questions, type Answers } from "@/lib/onboarding/model";
export function OnboardingWizard({
  initial,
  initialStep,
  email,
  onSave = saveOnboarding,
}: {
  initial: Answers;
  initialStep: number;
  email: string;
  onSave?: typeof saveOnboarding;
}) {
  const [answers, setAnswers] = useState(initial);
  const [step, setStep] = useState(Math.max(0, Math.min(7, initialStep)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = step ? questions[step - 1] : null;
  const valid =
    step === 0
      ? answers.name.trim().length >= 2
      : question?.key === "useCases"
        ? answers.useCases.length > 0
        : Boolean(question && answers[question.key]);
  function choose(value: string) {
    if (!question) return;
    setAnswers((a) => ({
      ...a,
      [question.key]:
        question.key === "useCases"
          ? a.useCases.includes(value)
            ? a.useCases.filter((v) => v !== value)
            : [...a.useCases, value]
          : value,
    }));
    setError("");
    setSaved(false);
  }
  function toggleAllUseCases() {
    if (!question || question.key !== "useCases") return;
    const all = question.options.map(([value]) => value);
    setAnswers((a) => ({
      ...a,
      useCases: a.useCases.length === all.length ? [] : [...all],
    }));
    setError("");
    setSaved(false);
  }
  function skipStep() {
    if (step < 1 || step >= 7 || busy) return;
    void persist(step + 1);
  }
  async function persist(target: number, complete = false, advance = true) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSave(answers, target, complete);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.destination) {
        window.location.assign(result.destination);
        return;
      }
      setSaved(true);
      if (advance) {
        setStep(target);
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch {
      setError(
        "Nuk u ruajtën përgjigjet. Kontrollo lidhjen dhe provo përsëri.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <aside className="onboarding-sidebar">
          <Link href="/" className="onboarding-brand">
            <BrandLogo size={34} />
          </Link>
          {step === 0 ? (
            <div className="onboarding-welcome">
              <h2>
                Mirë se erdhe!
                <br />
                Le të fillojmë.
              </h2>
              <p>
                Lidh Instagram-in, organizo produktet dhe kujdesu për klientët
                nga një vend.
              </p>
              <div className="onboarding-art">
                <Icon name="instagram" size={62} />
                <span>
                  <Icon name="spark" size={30} />
                </span>
              </div>
            </div>
          ) : (
            <ol aria-label="Pyetjet e personalizimit">
              {questions.map((q, i) => (
                <li
                  key={q.key}
                  aria-current={step === i + 1 ? "step" : undefined}
                  className={step > i + 1 ? "is-done" : ""}
                >
                  <span>{step > i + 1 ? "✓" : i + 1}</span>
                  {q.label}
                </li>
              ))}
            </ol>
          )}
          <div className="onboarding-user">
            <span>{email}</span>
            <form action={signOut}>
              <button disabled={busy} type="submit">
                Dil nga llogaria
              </button>
            </form>
          </div>
        </aside>
        <section className="onboarding-body">
          <div className="onboarding-progress">
            <progress
              max={7}
              value={step}
              aria-label="Progresi i personalizimit"
            />
            <span>{step === 0 ? "Rreth 2 minuta" : `${step} / 7`}</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void persist(Math.min(step + 1, 7), step === 7);
            }}
          >
            <fieldset disabled={busy}>
              <div className="onboarding-question">
                <span className="onboarding-eyebrow">
                  {step
                    ? "PERSONALIZO HAPËSIRËN TËNDE"
                    : "NJË FILLIM I THJESHTË"}
                </span>
                <h1 tabIndex={-1} ref={heading}>
                  {question?.title || "Le të përgatisim biznesin tënd"}
                </h1>
                <p>
                  {question?.description ||
                    "Disa pyetje të shkurtra për të përgatitur agjentin dhe hapat e parë. Të gjitha funksionet mbeten të disponueshme."}
                </p>
              </div>
              {!question ? (
                <div className="onboarding-intro">
                  <label htmlFor="business-name">Si quhet biznesi yt?</label>
                  <input
                    id="business-name"
                    autoComplete="organization"
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="p.sh. Zana Store"
                    value={answers.name}
                    onChange={(e) => {
                      setAnswers({ ...answers, name: e.target.value });
                      setSaved(false);
                    }}
                  />
                  <div className="onboarding-note">
                    <Icon name="spark" />
                    <p>
                      Do të krijojmë hapësirën tënde dhe një agjent me udhëzime
                      fillestare. Ti vendos kur të aktivizosh përgjigjet
                      automatike.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {question.key === "useCases" && (
                    <div className="onboarding-multi-tools">
                      <button
                        type="button"
                        className="onboarding-select-all"
                        onClick={toggleAllUseCases}
                      >
                        {answers.useCases.length === question.options.length
                          ? "Hiq të gjitha"
                          : "Zgjidh të gjitha"}
                      </button>
                    </div>
                  )}
                  <div
                    className={`onboarding-options ${question.key === "aiMode" ? "is-list" : ""}`}
                    role="group"
                    aria-label={question.title}
                  >
                    {question.options.map(([value, label, icon]) => {
                      const checked =
                        question.key === "useCases"
                          ? answers.useCases.includes(value)
                          : answers[question.key] === value;
                      return (
                        <label
                          key={value}
                          className={`onboarding-option ${checked ? "selected" : ""}`}
                        >
                          <input
                            type={
                              question.key === "useCases" ? "checkbox" : "radio"
                            }
                            name={question.key}
                            value={value}
                            checked={checked}
                            onChange={() => choose(value)}
                          />
                          <Icon name={icon} size={25} />
                          <span>{label}</span>
                          <span
                            className="onboarding-choice"
                            aria-hidden="true"
                          >
                            {checked ? "✓" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              {step === 7 && (
                <p className="onboarding-final-note">
                  Hapësira do të krijohet në emër të{" "}
                  <strong>{answers.name}</strong>. Pas kësaj mund të lidhësh
                  Instagram-in dhe të rishikosh rekomandimet.
                </p>
              )}
              {error && (
                <p className="onboarding-error" role="alert">
                  {error}
                </p>
              )}
              <div className="onboarding-actions">
                {step > 0 ? (
                  <button
                    className="onboarding-back"
                    type="button"
                    onClick={() => void persist(step - 1)}
                  >
                    ← Prapa
                  </button>
                ) : (
                  <Link href="/privacy">Privatësia</Link>
                )}
                <div className="onboarding-actions-end">
                  {step > 0 && step < 7 && (
                    <button
                      className="onboarding-skip"
                      type="button"
                      onClick={skipStep}
                    >
                      Anashkalo hapin
                    </button>
                  )}
                  <button
                    className="onboarding-next"
                    type="submit"
                    disabled={!valid || busy}
                  >
                    {busy
                      ? "Duke ruajtur…"
                      : step === 0
                        ? "Fillo personalizimin →"
                        : step === 7
                          ? "Krijo hapësirën →"
                          : "Vazhdo →"}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
          <div className="onboarding-save">
            <span role="status">
              {saved
                ? "Përgjigjet u ruajtën."
                : "Përgjigjet ruhen kur kalon te hapi tjetër."}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void persist(step, false, false)}
            >
              Ruaj për më vonë
            </button>
          </div>
          <p className="onboarding-disclaimer">
            Këto përgjigje përshtatin rekomandimet. Nuk kufizojnë funksionet apo
            numrin e produkteve, mesazheve dhe anëtarëve.
          </p>
        </section>
      </div>
    </main>
  );
}
