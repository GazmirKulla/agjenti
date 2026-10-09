"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { BrandLogo } from "@/components/brand/logo";
import { signOut } from "@/lib/auth/actions";
import { saveOnboarding } from "@/lib/onboarding/actions";
import {
  activeQuestions,
  allQuestionKeys,
  answerLabel,
  parseAnswers,
  type AnswerKey,
  type Answers,
} from "@/lib/onboarding/model";
import {
  audioFields,
  detailFields,
  emptyDetails,
  pendingConfirmations,
} from "@/lib/onboarding/audio-fields";
import {
  clarifications,
  correctField,
  fieldValue,
  hasValue,
} from "@/lib/onboarding/audio-model";
import { businessProfiles, offerMode, canonicalUseCases, useCaseDescriptions } from "@/lib/onboarding/rules";
import { CapabilityPicker } from "./capability-picker";
import { capabilityGroups } from "@/lib/onboarding/capability-groups";
import { AudioRecorder } from "./audio-recorder";
import { OnboardingWizard } from "./wizard";
import { OnboardingBasics } from "./basics";
import { audioGuide, initialOnboardingMode, reviewDetailFields } from "@/lib/onboarding/audio-guide";

type Transcript = { id: string; transcript: string };
export function OnboardingExperience({
  initial,
  initialStep,
  email,
  enabledSteps = allQuestionKeys,
  history = [],
}: {
  initial: Answers;
  initialStep: number;
  email: string;
  enabledSteps?: AnswerKey[];
  history?: Transcript[];
}) {
  const [answers, setAnswers] = useState(initial);
  const [mode, setMode] = useState(() => initialOnboardingMode(initial, initialStep));
  const [manualReviewed, setManualReviewed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [mode]);
  const [manualStep, setManualStep] = useState(initialStep);
  const [transcripts, setTranscripts] = useState(history);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [step2Back, setStep2Back] = useState<"basics" | "review">("basics");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const change = (field: string, value: string | string[] | boolean | null) => {
    setAnswers((current) => correctField(current, field, value));
    setSaved(false);
    setError("");
    setManualReviewed(false);
  };
  function navigate(next: typeof mode, current = answers) {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setError("");
    if (
      (next === "audio" || next === "written") &&
      (mode === "basics" || mode === "review")
    ) {
      setStep2Back(mode === "review" ? "review" : "basics");
    }
    setAnswers({ ...current, guidedOnboardingMode: next });
    setMode(next);
  }
  async function persistMode(nextMode: typeof mode) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = parseAnswers({ ...answers, guidedOnboardingMode: nextMode });
      const result = await saveOnboarding(next, 0, false);
      if (result.error) { setError(result.error); return; }
      if (result.destination) { window.location.assign(result.destination); return; }
      navigate(nextMode, next);
      setSaved(true);
    } catch {
      setError("Nuk u ruajtën përgjigjet. Provo përsëri; të dhënat mbeten në këtë faqe.");
    } finally {
      setBusy(false);
    }
  }
  async function analyze(file?: File) {
    if (busy) return;
    const version = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 150000);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let body: FormData | string;
      if (file) {
        const form = new FormData();
        form.set("audio", file);
        form.set("answers", JSON.stringify(answers));
        body = form;
      } else {
        const text = audioGuide({ ...answers, audioReview: undefined }, enabledSteps)
          .map((question) => {
            const value = fieldValue(answers, question.id);
            const answer = Array.isArray(value) ? value.join("\n") : String(value ?? "");
            return answer.trim() ? `${question.title}\n${answer}` : "";
          })
          .filter(Boolean).join("\n\n");
        if (!text) throw new Error("Shkruaj të paktën një përgjigje për të vazhduar.");
        body = JSON.stringify({ text, answers });
      }
      const response = await fetch(file ? "/api/onboarding/audio" : "/api/onboarding/text", {
        method: "POST",
        headers: file ? undefined : { "Content-Type": "application/json" },
        body,
        signal: controller.current.signal,
      });
      const result = await response.json();
      if (generation.current !== version) return;
      if (!response.ok)
        throw new Error(
          result.error || "Nuk u analizua regjistrimi. Provo përsëri.",
        );
      const next = parseAnswers(result.answers);
      setAnswers(next);
      setTranscripts((current) => [
        ...current,
        { id: result.analysisId, transcript: result.transcript },
      ]);
      setMode("review");
      setSaved(true);
    } catch (err) {
      if (generation.current === version)
        setError(
          err instanceof Error && err.name !== "AbortError"
            ? err.message
            : "Analiza zgjati shumë. Provo përsëri; përgjigjet mbeten në këtë faqe.",
        );
    } finally {
      clearTimeout(timer);
      if (generation.current === version) setBusy(false);
    }
  }
  function editedManual(input: unknown) {
    let next = parseAnswers(input);
    if (answers.audioReview) next.audioReview = answers.audioReview;
    if (answers.audioReview)
      for (const key of audioFields) {
        if (
          JSON.stringify(fieldValue(answers, key)) !==
          JSON.stringify(fieldValue(next, key))
        )
          next = correctField(next, key, fieldValue(next, key));
      }
    return next;
  }
  async function save(complete: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await saveOnboarding(answers, 0, complete);
      if (result.error) setError(result.error);
      else if (result.destination) window.location.assign(result.destination);
      else setSaved(true);
    } catch {
      setError("Nuk u ruajtën përgjigjet. Provo përsëri.");
    } finally {
      setBusy(false);
    }
  }
  if (mode === "manual")
    return (
      <OnboardingWizard
        initial={answers}
        initialStep={manualStep}
        email={email}
        enabledSteps={enabledSteps}
        onAudio={(current) => navigate(
          current.name.trim().length < 2 || (enabledSteps.includes("businessType") && !current.businessType)
            ? "basics" : "audio", editedManual(current))}
        onSave={async (input, step, complete) => {
          const next = { ...editedManual(input), guidedOnboardingMode: "manual" as const };
          setAnswers(next);
          setManualStep(step);
          if (complete && next.audioReview) {
            const result = await saveOnboarding({ ...next, guidedOnboardingMode: "review" }, step, false);
            if (!result.error && !result.destination) navigate("review", next);
            return result;
          }
          return saveOnboarding(next, step, complete);
        }}
      />
    );
  const review = answers.audioReview;
  const reviewInputMode = review?.inputMode === "audio" ? "audio" : "written";
  const pending = review ? pendingConfirmations(review) : [];
  const missing = clarifications(answers, enabledSteps);
  const details = answers.details ?? emptyDetails;
  function focusField(field: string) {
    if (field === "name") {
      navigate("basics");
      return;
    }
    const target = document.getElementById(`audio-${field}`);
    const group = target?.closest("details");
    if (group) group.open = true;
    target?.focus();
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function badge(field: string) {
    if (
      Object.hasOwn(review?.corrections ?? {}, field) ||
      review?.confirmedFields.includes(field)
    )
      return "Konfirmuar";
    if (!hasValue(fieldValue(answers, field))) return "Pa përcaktuar";
    if (pending.includes(field)) return "Kërkon konfirmim";
    return review?.confidence[field] != null
      ? "Besim i lartë"
      : "Për t’u rishikuar";
  }
  function confirm(field: string) {
    if (review)
      setAnswers({
        ...answers,
        audioReview: {
          ...review,
          reviewed: false,
          confirmedFields: [...new Set([...review.confirmedFields, field])],
        },
      });
    setSaved(false);
  }
  const labels: Record<string, string> = {
    name: "Emri i biznesit",
    businessType: "Lloji i biznesit",
    offeringTypes: "Oferta",
    useCases: "Qëllimet",
    agentCapabilities: "Aftësitë e Agjentit",
    productCount: "Numri i produkteve/shërbimeve",
    messageVolume: "Mesazhet mujore",
    teamSize: "Ekipi",
    ...detailFields,
  };
  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <aside className="onboarding-sidebar">
          <Link href="/" className="onboarding-brand">
            <BrandLogo size={34} />
          </Link>
          <div className="onboarding-welcome">
            <h2>
              Biznesi yt,
              <br />
              me fjalët e tua.
            </h2>
            <p>
              Na trego shkurt çfarë bën. Pastaj kontrollo dhe përshtat
              konfigurimin.
            </p>
          </div>
          <div className="onboarding-user">
            <span>{email}</span>
            <form action={signOut}>
              <button type="submit">Dil nga llogaria</button>
            </form>
          </div>
        </aside>
        <section className={`onboarding-body onboarding-hybrid ${mode === "review" ? "onboarding-review" : ""}`}>
          <div className="onboarding-progress">
            <progress
              max={3}
              value={mode === "basics" ? 1 : mode === "review" ? 3 : 2}
              aria-label="Progresi i konfigurimit"
            />
            <span>
              {mode === "basics" ? "1 / 3 · Bazat" : mode === "review" ? "3 / 3 · Kontrolli" : "2 / 3 · Biznesi yt"}
            </span>
          </div>
          <div className="onboarding-question">
            {(mode === "basics" || mode === "review") && (
              <span className="onboarding-eyebrow">
                {mode === "basics" ? "LE TË FILLOJMË" : "PROFILI YT FILLESTAR"}
              </span>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {mode === "basics" ? "Fillojmë me bazat e biznesit"
                : mode === "audio" || mode === "written"
                ? "Na trego për biznesin"
                : review ? "Ja çfarë kuptuam për biznesin tënd" : "Kontrollo profilin e biznesit"}
            </h1>
            <p>
              {mode === "basics" ? "Vendos emrin, kategorinë dhe çfarë ofron biznesi yt."
                : mode === "written" || mode === "audio"
                ? "Përgjigju pyetjeve më poshtë, me zë ose me shkrim."
                : "Kontrollo të dhënat më poshtë. Hap një fushë për ta ndryshuar, pastaj konfirmo profilin."}
            </p>
          </div>
          {(mode === "audio" || mode === "written") && (
            <div className="onboarding-input-modes" role="group" aria-label="Mënyra e përgjigjes">
              <button type="button" aria-pressed={mode === "audio"} disabled={busy}
                className={mode === "audio" ? "onboarding-next" : "onboarding-back"}
                onClick={() => { if (mode !== "audio") navigate("audio"); }}>
                Përgjigju me audio
              </button>
              <button type="button" aria-pressed={mode === "written"} disabled={busy}
                className={mode === "written" ? "onboarding-next" : "onboarding-back"}
                onClick={() => { if (mode !== "written") navigate("written"); }}>
                Përgjigju me shkrim
              </button>
            </div>
          )}
          {mode === "basics" ? (
            <OnboardingBasics answers={answers} enabledSteps={enabledSteps} busy={busy}
              onChange={change} onContinue={() => persistMode("audio")} />
          ) : mode === "written" ? (
            <form onSubmit={(event) => { event.preventDefault(); void analyze(); }}>
              <fieldset disabled={busy}>
                {audioGuide({ ...answers, audioReview: undefined }, enabledSteps).map((question) => (
                  <label key={question.id} className="onboarding-detail-input" htmlFor={`written-${question.id}`}>
                    <strong>{question.title}</strong>
                    <span className="onboarding-basics-hint" id={`hint-${question.id}`}>{question.hint}</span>
                    <textarea id={`written-${question.id}`} rows={3} maxLength={2000}
                      aria-describedby={`hint-${question.id}`}
                      value={question.id === "offeringsSummary" ? (details.offeringsSummary ?? []).join("\n") : String(fieldValue(answers, question.id) ?? "")}
                      onChange={(event) => change(question.id, question.id === "offeringsSummary" ? event.target.value.split("\n") : event.target.value)} />
                  </label>
                ))}
                <div className="onboarding-actions">
                  <button type="button" className="onboarding-back" onClick={() => navigate(step2Back)}>Kthehu</button>
                  <button type="submit" className="onboarding-next">{busy ? "Duke analizuar përgjigjet…" : "Vazhdo"}</button>
                </div>
              </fieldset>
            </form>
          ) : mode === "audio" ? (
            <>
              <AudioRecorder busy={busy} onAnalyze={analyze} questions={audioGuide(answers, enabledSteps)} analyzeLabel="Vazhdo"
                onBack={() => navigate(step2Back)} />
              {review && (
                <p className="onboarding-note">
                  Regjistrimi tjetër plotëson profilin ekzistues. Korrigjimet e
                  tua manuale ruhen.
                </p>
              )}
            </>
          ) : (
            <>
              {(missing.length > 0 || pending.length > 0) && (
                <section
                  className="onboarding-clarifications"
                  aria-label="Sqarimet e nevojshme"
                >
                  <h2>Disa detaje për t’u sqaruar</h2>
                  <p className="onboarding-clarifications-intro">Plotëso detajet më poshtë në mënyrën që preferon.</p>
                  {missing.map((item) => (
                    <div className="onboarding-clarification-item" key={`${item.field}-${item.message}`}>
                      <p>{item.message}</p>
                      <button
                        className="onboarding-skip"
                        onClick={() => focusField(item.field)}
                      >
                        Plotëso fushën →
                      </button>
                    </div>
                  ))}
                  {pending.map((field) => (
                    <div className="onboarding-clarification-item" key={field}>
                      <p>Konfirmo: {labels[field] || field}.</p>
                      <button
                        className="onboarding-skip"
                        onClick={() => focusField(field)}
                      >
                        Rishiko fushën →
                      </button>
                    </div>
                  ))}
                  <div className="onboarding-reply-choices" role="group" aria-label="Mënyra e përgjigjes">
                    <button type="button" disabled={busy} onClick={() => navigate("written")} className="onboarding-reply-card">
                      <span className="onboarding-reply-icon"><Icon name="edit" size={22} /></span>
                      <span className="onboarding-reply-copy"><strong>Tekst</strong><small>Shkruaj ose plotëso përgjigjet</small></span>
                      <Icon name="arrow" size={18} />
                    </button>
                    <button type="button" disabled={busy} onClick={() => navigate("audio")} className="onboarding-reply-card">
                      <span className="onboarding-reply-icon"><Icon name="microphone" size={22} /></span>
                      <span className="onboarding-reply-copy"><strong>Audio</strong><small>Na trego me fjalët e tua</small></span>
                      <Icon name="arrow" size={18} />
                    </button>
                  </div>
                </section>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(true);
                }}
              >
                <fieldset disabled={busy}>
                  <div className="onboarding-review-heading">
                    <h2>Profili i biznesit</h2>
                    <p>Të dhënat bazë dhe konfigurimi i agjentit.</p>
                  </div>
                  {activeQuestions(enabledSteps, answers).map((question) => {
                    const field =
                      question.key === "productType"
                        ? "offeringTypes"
                        : question.key === "aiMode"
                          ? "agentCapabilities"
                          : question.key;
                    const value = field === "offeringTypes" ? offerMode(answers.offeringTypes) : field === "useCases" ? canonicalUseCases(answers.useCases) : fieldValue(answers, field);
                    const multi = [
                      "useCases",
                      "agentCapabilities",
                    ].includes(field);
                    const selected = Array.isArray(value)
                      ? value
                      : typeof value === "string" && value
                        ? [value]
                        : [];
                    return (
                      <details
                        className="onboarding-review-field"
                        key={question.key}
                      >
                        <summary>
                          <span>
                            <strong>{question.label}</strong>
                            <small>
                              {(field === "agentCapabilities" ? capabilityGroups(question.options).filter(group => group.capabilities.some(id => selected.includes(id))).map(group => group.label) : selected
                                .map((v) => question.options.find(([id]) => id === v)?.[1] ?? answerLabel(question.key, v)))
                                .join(", ") || "Pa përcaktuar"}
                            </small>
                          </span>
                          <span
                            className={`onboarding-confidence ${pending.includes(field) ? "is-low" : !hasValue(value) || badge(field) === "Për t’u rishikuar" ? "is-neutral" : ""}`}
                          >
                            {badge(field)}
                          </span>
                        </summary>
                        <div
                          id={`audio-${field}`}
                          tabIndex={-1}
                          className="onboarding-options"
                        >
                          {field === "agentCapabilities" ? <CapabilityPicker options={question.options} selected={selected} onChange={value => change(field, value)} /> : question.options.map(([id, label]) => (
                            <label
                              className={`onboarding-option ${selected.includes(id) ? "selected" : ""}`}
                              key={id}
                            >
                              <input
                                type={multi ? "checkbox" : "radio"}
                                name={field}
                                checked={selected.includes(id)}
                                onChange={() => {
                                  const chosen = selected.includes(id)
                                    ? selected.filter((v) => v !== id)
                                    : [...selected, id];
                                  if (field === "offeringTypes") {
                                    change(field, [id]);
                                  } else change(field, multi ? chosen : id);
                                }}
                              />
                              <span>{label}{field === "useCases" && <small className="onboarding-goal-description">{useCaseDescriptions[id]}</small>}</span>
                              <span
                                className="onboarding-choice"
                                aria-hidden="true"
                              >
                                {selected.includes(id) ? "✓" : ""}
                              </span>
                            </label>
                          ))}
                        </div>
                        {question.optional && (
                          <button
                            type="button"
                            className="onboarding-skip"
                            onClick={() => change(field, multi ? [] : "")}
                          >
                            Lëre pa përcaktuar
                          </button>
                        )}
                        {pending.includes(field) && (
                          <button
                            type="button"
                            className="onboarding-back"
                            onClick={() => confirm(field)}
                          >
                            Konfirmo këtë të dhënë
                          </button>
                        )}
                      </details>
                    );
                  })}
                  <div className="onboarding-review-heading">
                    <h2>Oferta dhe klientët</h2>
                    <p>Çfarë ofron dhe si do t’i ndihmojë agjenti klientët.</p>
                  </div>
                  <section className="onboarding-offerings" aria-labelledby="onboarding-offerings-title">
                    <div className="onboarding-offerings-heading">
                      <h3 id="onboarding-offerings-title">Produktet dhe shërbimet e përmendura</h3>
                      {pending.includes("offeringsSummary") && (
                        <span className="onboarding-confidence is-low">Kërkon konfirmim</span>
                      )}
                    </div>
                    {details.offeringsSummary?.some((item) => item.trim()) ? (
                      <ul>
                        {details.offeringsSummary.filter((item) => item.trim()).map((item, index) => (
                          <li key={`${index}-${item}`}><span aria-hidden="true">{index + 1}</span>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="onboarding-offerings-empty">Nuk janë përmendur produkte ose shërbime. Mund t’i shtosh më poshtë.</p>
                    )}
                    <details className="onboarding-review-field">
                      <summary><strong>Ndrysho listën</strong></summary>
                      <label className="onboarding-detail-input" htmlFor="audio-offeringsSummary">
                        Shkruaj një produkt ose shërbim për çdo rresht.
                        <textarea id="audio-offeringsSummary" rows={4} maxLength={2000}
                          value={details.offeringsSummary?.join("\n") ?? ""}
                          onChange={(event) => change("offeringsSummary", event.target.value.split("\n"))} />
                      </label>
                    </details>
                    {pending.includes("offeringsSummary") && (
                      <button type="button" className="onboarding-back" onClick={() => confirm("offeringsSummary")}>Konfirmo listën</button>
                    )}
                  </section>
                  {reviewDetailFields(answers).map(([field, label]) => (
                    <details className="onboarding-review-field" key={field}>
                      <summary>
                        <span>
                          <strong>{label}</strong>
                          <small>
                            {Array.isArray(fieldValue(answers, field))
                              ? (fieldValue(answers, field) as string[]).join(
                                  ", ",
                                )
                              : typeof fieldValue(answers, field) === "boolean"
                                ? fieldValue(answers, field)
                                  ? "Po"
                                  : "Jo"
                                : field === "businessCategory" &&
                                    details.businessCategory
                                  ? businessProfiles[
                                      details.businessCategory as keyof typeof businessProfiles
                                    ]?.label
                                  : String(
                                      fieldValue(answers, field) ||
                                        "Pa përcaktuar",
                                    )}
                          </small>
                        </span>
                        <span
                          className={`onboarding-confidence ${pending.includes(field) ? "is-low" : !hasValue(fieldValue(answers, field)) || badge(field) === "Për t’u rishikuar" ? "is-neutral" : ""}`}
                        >
                          {badge(field)}
                        </span>
                      </summary>
                      <div className="onboarding-detail-input">
                        <span id={`audio-label-${field}`}>{label}</span>
                        {field === "businessCategory" ? (
                          <select
                            id={`audio-${field}`}
                            aria-labelledby={`audio-label-${field}`}
                            value={details.businessCategory ?? ""}
                            onChange={(e) =>
                              change(field, e.target.value || null)
                            }
                          >
                            <option value="">Pa përcaktuar</option>
                            {Object.entries(businessProfiles).map(
                              ([id, profile]) => (
                                <option key={id} value={id}>
                                  {profile.label}
                                </option>
                              ),
                            )}
                          </select>
                        ) : [
                            "sellsProducts",
                            "hasVariants",
                            "isPersonalized",
                          ].includes(field) ? (
                          <div>
                            <div id={`audio-${field}`} tabIndex={-1} className="onboarding-boolean-options"
                              role="radiogroup" aria-labelledby={`audio-label-${field}`}>
                              {[true, false].map((value) => (
                                <label key={String(value)} className="onboarding-boolean-choice">
                                  <input type="radio" name={`boolean-${field}`} value={String(value)}
                                    checked={fieldValue(answers, field) === value}
                                    onChange={() => change(field, value)} />
                                  <span>{value ? "Po" : "Jo"}</span>
                                </label>
                              ))}
                            </div>
                            {fieldValue(answers, field) != null && (
                              <button type="button" className="onboarding-skip onboarding-boolean-clear" onClick={() => change(field, null)}>Hiq zgjedhjen</button>
                            )}
                          </div>
                        ) : (
                          <textarea
                            id={`audio-${field}`}
                            aria-labelledby={`audio-label-${field}`}
                            rows={3}
                            maxLength={2000}
                            value={
                              field === "offeringsSummary"
                                ? (details.offeringsSummary?.join("\n") ?? "")
                                : String(fieldValue(answers, field) ?? "")
                            }
                            onChange={(e) =>
                              change(
                                field,
                                field === "offeringsSummary"
                                  ? e.target.value.split("\n")
                                  : e.target.value || null,
                              )
                            }
                          />
                        )}
                      </div>
                      {pending.includes(field) && (
                        <button
                          type="button"
                          className="onboarding-back"
                          onClick={() => confirm(field)}
                        >
                          Konfirmo këtë të dhënë
                        </button>
                      )}
                    </details>
                  ))}
                  <div className="onboarding-review-footer">
                    <label className="onboarding-review-confirm">
                      <input
                        type="checkbox"
                        checked={review ? review.reviewed : manualReviewed}
                        onChange={(e) =>
                          review ? setAnswers({
                            ...answers,
                            audioReview: {
                              ...review,
                              reviewed: e.target.checked,
                            },
                          }) : setManualReviewed(e.target.checked)
                        }
                      />
                      <span>I kontrollova të dhënat dhe dua ta krijoj hapësirën me këtë profil.</span>
                    </label>
                    <div className="onboarding-actions">
                      <button type="button" className="onboarding-back" onClick={() => navigate(reviewInputMode)}>Kthehu</button>
                      <button
                        className="onboarding-next"
                        type="submit"
                        disabled={busy || !(review ? review.reviewed : manualReviewed) || pending.length > 0}
                      >
                        {busy ? "Duke ruajtur…" : "Konfirmo dhe krijo hapësirën →"}
                      </button>
                    </div>
                  </div>
                  <div className="onboarding-review-alternatives" role="group" aria-label="Plotëso përgjigjet">
                    <span>Ke diçka për të shtuar?</span>
                    <button
                      type="button"
                      className="onboarding-skip"
                      onClick={() => navigate("audio")}
                    >
                      Përgjigju me audio
                    </button>
                    <button
                      type="button"
                      className="onboarding-skip"
                      onClick={() => navigate("written")}
                    >
                      Përgjigju me shkrim
                    </button>
                  </div>
                </fieldset>
              </form>
              <div className="onboarding-save">
                <span role="status">
                  {saved
                    ? "Përgjigjet u ruajtën."
                    : "Ruaj ndryshimet për të vazhduar më vonë."}
                </span>
                <button disabled={busy} onClick={() => void save(false)}>
                  Ruaj për më vonë
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="onboarding-error" role="alert">
              {error}
            </p>
          )}
          {transcripts.length > 0 && (
            <details className="onboarding-transcripts">
              <summary>
                Përgjigjet e analizuara ({transcripts.length})
              </summary>
              {transcripts.map((item, index) => (
                <p key={item.id}>
                  <strong>Përgjigjja {index + 1}</strong>
                  <br />
                  {item.transcript}
                </p>
              ))}
            </details>
          )}
          <p className="onboarding-disclaimer">
            Përgjigjet përshtatin konfigurimin fillestar. Të gjitha funksionet
            mbeten të disponueshme.
          </p>
        </section>
      </div>
    </main>
  );
}
