"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import { businessProfiles } from "@/lib/onboarding/rules";
import { AudioRecorder } from "./audio-recorder";
import { OnboardingWizard } from "./wizard";

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
  const [mode, setMode] = useState<"audio" | "manual" | "review">(
    initial.audioReview ? "review" : initialStep > 0 ? "manual" : "audio",
  );
  const [manualStep, setManualStep] = useState(initialStep);
  const [transcripts, setTranscripts] = useState(history);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
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
  };
  function navigate(next: typeof mode, current = answers) {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setError("");
    setAnswers(current);
    setMode(next);
  }
  async function analyze(file: File) {
    const version = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 150000);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const form = new FormData();
      form.set("audio", file);
      form.set("answers", JSON.stringify(answers));
      const response = await fetch("/api/onboarding/audio", {
        method: "POST",
        body: form,
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
            : "Analiza zgjati shumë. Provo përsëri ose plotëso manualisht.",
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
        onAudio={(current) => navigate("audio", editedManual(current))}
        onSave={async (input, step, complete) => {
          const next = editedManual(input);
          setAnswers(next);
          setManualStep(step);
          if (complete && next.audioReview) {
            const result = await saveOnboarding(next, step, false);
            if (!result.error && !result.destination) setMode("review");
            return result;
          }
          return saveOnboarding(next, step, complete);
        }}
      />
    );
  const review = answers.audioReview;
  const pending = review ? pendingConfirmations(review) : [];
  const missing = clarifications(answers, enabledSteps);
  const details = answers.details ?? emptyDetails;
  function focusField(field: string) {
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
        <section className="onboarding-body onboarding-hybrid">
          <div className="onboarding-progress">
            <progress
              max={2}
              value={mode === "review" ? 1 : 0}
              aria-label="Progresi i konfigurimit me audio"
            />
            <span>
              {mode === "review" ? "Rishiko dhe konfirmo" : "Le të fillojmë"}
            </span>
          </div>
          <div className="onboarding-question">
            <span className="onboarding-eyebrow">
              {mode === "audio"
                ? "NA TREGO PËR BIZNESIN"
                : "PROFILI YT FILLESTAR"}
            </span>
            <h1>
              {mode === "audio"
                ? "Na trego shkurt për biznesin tënd"
                : "Ja çfarë kuptuam për biznesin tënd"}
            </h1>
            <p>
              {mode === "audio"
                ? "Regjistro një audio të shkurtër. Mund ta dëgjosh dhe ta regjistrosh përsëri përpara analizës."
                : "Kontrollo përmbledhjen. Hap çdo fushë për ta korrigjuar; informacionet që mungojnë mund t’i plotësosh me zë ose manualisht."}
            </p>
          </div>
          {mode === "audio" ? (
            <>
              <AudioRecorder busy={busy} onAnalyze={analyze} />
              {review && (
                <p className="onboarding-note">
                  Regjistrimi tjetër plotëson profilin ekzistues. Korrigjimet e
                  tua manuale ruhen.
                </p>
              )}
              <div className="onboarding-audio-buttons">
                {review && (
                  <button
                    className="onboarding-back"
                    onClick={() => navigate("review")}
                  >
                    ← Kthehu te profili
                  </button>
                )}
                <button
                  className="onboarding-back"
                  onClick={() => navigate("manual")}
                >
                  {busy
                    ? "Anulo analizën dhe plotëso manualisht"
                    : "Ose vazhdo manualisht"}
                </button>
              </div>
            </>
          ) : (
            <>
              {(missing.length > 0 || pending.length > 0) && (
                <section
                  className="onboarding-clarifications"
                  aria-label="Sqarimet e nevojshme"
                >
                  <h2>Disa detaje për t’u sqaruar</h2>
                  {missing.map((item) => (
                    <div key={`${item.field}-${item.message}`}>
                      <p>{item.message}</p>
                      <button
                        className="onboarding-skip"
                        onClick={() => focusField(item.field)}
                      >
                        Përgjigju manualisht →
                      </button>
                    </div>
                  ))}
                  {pending.map((field) => (
                    <div key={field}>
                      <p>Konfirmo: {labels[field] || field}.</p>
                      <button
                        className="onboarding-skip"
                        onClick={() => focusField(field)}
                      >
                        Rishiko fushën →
                      </button>
                    </div>
                  ))}
                  <button
                    className="onboarding-back"
                    onClick={() => navigate("audio")}
                  >
                    Regjistro audio tjetër
                  </button>
                </section>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(true);
                }}
              >
                <fieldset disabled={busy}>
                  <div className="onboarding-intro">
                    <label htmlFor="audio-name">Emri i biznesit</label>
                    <input
                      id="audio-name"
                      value={answers.name}
                      minLength={2}
                      maxLength={100}
                      required
                      autoComplete="organization"
                      onChange={(e) => change("name", e.target.value)}
                    />
                    {pending.includes("name") && (
                      <button
                        type="button"
                        className="onboarding-skip"
                        onClick={() => confirm("name")}
                      >
                        Konfirmo emrin
                      </button>
                    )}
                  </div>
                  {activeQuestions(allQuestionKeys, answers).map((question) => {
                    const field =
                      question.key === "productType"
                        ? "offeringTypes"
                        : question.key === "aiMode"
                          ? "agentCapabilities"
                          : question.key;
                    const value = fieldValue(answers, field);
                    const multi = [
                      "offeringTypes",
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
                              {selected
                                .map((v) => answerLabel(question.key, v))
                                .join(", ") || "Pa përcaktuar"}
                            </small>
                          </span>
                          <span
                            className={`onboarding-confidence ${pending.includes(field) ? "is-low" : ""}`}
                          >
                            {badge(field)}
                          </span>
                        </summary>
                        <div
                          id={`audio-${field}`}
                          tabIndex={-1}
                          className="onboarding-options"
                        >
                          {question.options.map(([id, label]) => (
                            <label
                              className={`onboarding-option ${selected.includes(id) ? "selected" : ""}`}
                              key={id}
                            >
                              <input
                                type={multi ? "checkbox" : "radio"}
                                name={field}
                                checked={selected.includes(id)}
                                onChange={() => {
                                  let chosen = selected.includes(id)
                                    ? selected.filter((v) => v !== id)
                                    : [...selected, id];
                                  if (field === "offeringTypes")
                                    chosen = ["services", "mixed"].includes(id)
                                      ? selected.includes(id)
                                        ? []
                                        : [id]
                                      : chosen.filter(
                                          (v) =>
                                            !["services", "mixed"].includes(v),
                                        );
                                  change(field, multi ? chosen : id);
                                }}
                              />
                              <span>{label}</span>
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
                  {Object.entries(detailFields).map(([field, label]) => (
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
                                      fieldValue(answers, field) ??
                                        "Pa përcaktuar",
                                    )}
                          </small>
                        </span>
                        <span
                          className={`onboarding-confidence ${pending.includes(field) ? "is-low" : ""}`}
                        >
                          {badge(field)}
                        </span>
                      </summary>
                      <label
                        className="onboarding-detail-input"
                        htmlFor={`audio-${field}`}
                      >
                        {label}
                        {field === "businessCategory" ? (
                          <select
                            id={`audio-${field}`}
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
                          <select
                            id={`audio-${field}`}
                            value={
                              fieldValue(answers, field) == null
                                ? ""
                                : String(fieldValue(answers, field))
                            }
                            onChange={(e) =>
                              change(
                                field,
                                e.target.value === ""
                                  ? null
                                  : e.target.value === "true",
                              )
                            }
                          >
                            <option value="">Nuk është përcaktuar</option>
                            <option value="true">Po</option>
                            <option value="false">Jo</option>
                          </select>
                        ) : (
                          <textarea
                            id={`audio-${field}`}
                            rows={3}
                            maxLength={2000}
                            value={
                              field === "offeringsSummary"
                                ? (details.offeringsSummary?.join("\n") ?? "")
                                : (details.businessDescription ?? "")
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
                      </label>
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
                  <div className="onboarding-profile-preview">
                    <h2>Hapat e rekomanduar</h2>
                    <ul>
                      {answers.businessProfile?.recommendedConfiguration.checklist.map(
                        (item) => (
                          <li key={item}>{item}</li>
                        ),
                      )}
                    </ul>
                    <p>
                      Produktet dhe shërbimet e përmendura nuk shtohen
                      automatikisht në katalog. Mund t’i përgatitësh pas
                      krijimit të hapësirës.
                    </p>
                  </div>
                  <label className="onboarding-review-confirm">
                    <input
                      type="checkbox"
                      checked={review?.reviewed ?? false}
                      onChange={(e) =>
                        review &&
                        setAnswers({
                          ...answers,
                          audioReview: {
                            ...review,
                            reviewed: e.target.checked,
                          },
                        })
                      }
                    />
                    I kontrollova të dhënat dhe dua ta krijoj hapësirën me këtë
                    profil.
                  </label>
                  <button
                    className="onboarding-next"
                    type="submit"
                    disabled={busy || !review?.reviewed || pending.length > 0}
                  >
                    {busy ? "Duke ruajtur…" : "Konfirmo dhe krijo hapësirën →"}
                  </button>
                  <div className="onboarding-audio-buttons">
                    <button
                      type="button"
                      className="onboarding-back"
                      onClick={() => navigate("audio")}
                    >
                      Shto informacion me audio
                    </button>
                    <button
                      type="button"
                      className="onboarding-back"
                      onClick={() => navigate("manual")}
                    >
                      Plotëso manualisht
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
                Çfarë dëgjuam ({transcripts.length} regjistrime)
              </summary>
              {transcripts.map((item, index) => (
                <p key={item.id}>
                  <strong>Regjistrimi {index + 1}</strong>
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
