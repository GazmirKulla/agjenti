"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";
import { signOut } from "@/lib/auth/actions";
import { saveOnboarding } from "@/lib/onboarding/actions";
import {
  activeQuestions,
  allQuestionKeys,
  answerLabel,
  recommendations,
  resumeWizardStep,
  wizardStepToStored,
  type AnswerKey,
  type Answers,
} from "@/lib/onboarding/model";
import { correctField } from "@/lib/onboarding/audio-model";
import { normalizeConditionalAnswers, offerMode } from "@/lib/onboarding/rules";
export function OnboardingWizard({
  initial,
  initialStep,
  email,
  enabledSteps = allQuestionKeys,
  onSave = saveOnboarding,
  onAudio,
}: {
  initial: Answers;
  initialStep: number;
  email: string;
  enabledSteps?: AnswerKey[];
  onSave?: typeof saveOnboarding;
  onAudio?: (answers: Answers) => void;
}) {
  const [answers, setAnswers] = useState(initial);
  const active = useMemo(
    () => activeQuestions(enabledSteps, answers),
    [enabledSteps, answers],
  );
  const total = active.length;
  const startingQuestions = activeQuestions(enabledSteps, initial);
  const [stepKey, setStepKey] = useState<AnswerKey | null>(() => {
    const index = resumeWizardStep(initialStep, startingQuestions);
    return startingQuestions[index - 1]?.key ?? null;
  });
  const step = stepKey ? active.findIndex((q) => q.key === stepKey) + 1 : 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = step ? active[step - 1] : null;
  const valid =
    step === 0
      ? answers.name.trim().length >= 2
      : question?.optional
        ? true
        : question?.key === "useCases"
          ? answers.useCases.length > 0
          : question?.key === "productType"
            ? answers.offeringTypes.length > 0
            : Boolean(question && answers[question.key]);
  function choose(value: string) {
    if (!question) return;
    setAnswers((current) => {
      if (question.key === "productType") return correctField(current, "offeringTypes", [value]);
      const multiKey =
        question.key === "useCases" ||
        question.key === "aiMode";
      const currentValues =
        question.key === "useCases"
          ? current.useCases
          : question.key === "aiMode"
            ? current.agentCapabilities
            : [];
      const selected = multiKey
        ? currentValues.includes(value)
          ? currentValues.filter((item) => item !== value)
          : [...currentValues, value]
        : currentValues;
      const next = { ...current };
      if (question.key === "useCases") next.useCases = selected;
      else if (question.key === "aiMode") next.agentCapabilities = selected;
      else if (question.key === "businessType") next.businessType = value;
      else if (question.key === "productCount") next.productCount = value;
      else if (question.key === "messageVolume") next.messageVolume = value;
      else if (question.key === "teamSize") next.teamSize = value;
      const normalized = normalizeConditionalAnswers(next);
      return {
        ...normalized,
        selectedUseCases: [...normalized.useCases],
        productType: normalized.offeringTypes[0] ?? "",
        aiMode: normalized.agentCapabilities[0] ?? "",
      };
    });
    setError("");
    setSaved(false);
  }
  function toggleAllUseCases() {
    if (!question || question.key !== "useCases") return;
    const all = question.options.map(([value]) => value);
    setAnswers((current) => {
      const normalized = normalizeConditionalAnswers({
        ...current,
        useCases: current.useCases.length === all.length ? [] : [...all],
      });
      return { ...normalized, selectedUseCases: [...normalized.useCases] };
    });
    setError("");
    setSaved(false);
  }
  function skipStep() {
    if (step < 1 || !question?.optional || busy) return;
    const next = active[step]?.key ?? null;
    void persist(next, next === null);
  }
  async function persist(
    target: AnswerKey | null,
    complete = false,
    advance = true,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSave(
        answers,
        complete
          ? wizardStepToStored(total, active)
          : target
            ? wizardStepToStored(
                active.findIndex((q) => q.key === target) + 1,
                active,
              )
            : 0,
        complete,
      );
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
        setStepKey(target);
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
              {active.map((q, i) => (
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
          {onAudio && (
            <button
              type="button"
              className="onboarding-skip"
              disabled={busy}
              onClick={() => onAudio(answers)}
            >
              Na trego me audio →
            </button>
          )}
          <div className="onboarding-progress">
            <progress
              max={Math.max(total, 1)}
              value={step}
              aria-label="Progresi i personalizimit"
            />
            <span>
              {step === 0
                ? "Rreth 2 minuta"
                : `${step} / ${Math.max(total, 1)}`}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              if (step >= total) void persist(question?.key ?? null, true);
              else void persist(active[step]?.key ?? null);
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
                      <button type="button" className="onboarding-select-all" onClick={toggleAllUseCases}>
                        {answers.useCases.length === question.options.length ? "Hiq të gjitha" : "Zgjidh të gjitha"}
                      </button>
                    </div>
                  )}
                  <div
                    className={`onboarding-options ${question.key === "aiMode" ? "is-list" : ""}`}
                    role="group"
                    aria-label={question.title}
                  >
                    {question.options.map(([value, label, icon]) => {
                      const multi =
                        question.key === "useCases" ||
                        question.key === "aiMode";
                      const selectedValues =
                        question.key === "productType"
                          ? answers.offeringTypes
                          : question.key === "useCases"
                            ? answers.useCases
                            : question.key === "aiMode"
                              ? answers.agentCapabilities
                              : [];
                      const checked = question.key === "productType" ? offerMode(answers.offeringTypes) === value : multi
                        ? selectedValues.includes(value)
                        : question.key === "businessType"
                          ? answers.businessType === value
                          : question.key === "productCount"
                            ? answers.productCount === value
                            : question.key === "messageVolume"
                              ? answers.messageVolume === value
                              : question.key === "teamSize"
                                ? answers.teamSize === value
                                : false;
                      return (
                        <label
                          key={value}
                          className={`onboarding-option ${checked ? "selected" : ""}`}
                        >
                          <input
                            type={multi ? "checkbox" : "radio"}
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
              {step > 0 && step === total && (
                <p className="onboarding-final-note">
                  Hapësira do të krijohet në emër të{" "}
                  <strong>{answers.name}</strong>. Pas kësaj mund të lidhësh
                  Instagram-in dhe të rishikosh rekomandimet.
                </p>
              )}
              {step > 0 && step === total && (
                <div className="onboarding-profile-preview">
                  <h2>Përmbledhja e konfigurimit fillestar</h2>
                  <p>
                    <strong>Biznesi:</strong>{" "}
                    {answerLabel("businessType", answers.businessType)}
                  </p>
                  <p>
                    <strong>Oferta:</strong>{" "}
                    {answers.offeringTypes
                      .map((value) => answerLabel("productType", value))
                      .join(", ") || "Pa përcaktuar"}
                  </p>
                  <p>
                    <strong>Qëllimet:</strong>{" "}
                    {answers.useCases
                      .map((value) => answerLabel("useCases", value))
                      .join(", ") || "Pa përcaktuar"}
                  </p>
                  <p>
                    <strong>Aftësitë:</strong>{" "}
                    {answers.agentCapabilities
                      .map((value) => answerLabel("aiMode", value))
                      .join(", ") || "Do të përcaktohen më vonë"}
                  </p>
                  <ul>
                    {recommendations(answers).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {step === 0 && total === 0 && (
                <p className="onboarding-final-note">
                  Hapësira do të krijohet në emër të{" "}
                  <strong>{answers.name || "biznesit tënd"}</strong>.
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
                    onClick={() =>
                      void persist(
                        step <= 1 ? null : (active[step - 2]?.key ?? null),
                      )
                    }
                  >
                    Kthehu
                  </button>
                ) : (
                  <Link href="/privacy">Privatësia</Link>
                )}
                <div className="onboarding-actions-end">
                  {step > 0 && question?.optional && (
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
                      : step === 0 && total > 0
                        ? "Vazhdo"
                        : step >= total
                          ? "Krijo hapësirën →"
                          : "Vazhdo"}
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
              onClick={() => void persist(question?.key ?? null, false, false)}
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
