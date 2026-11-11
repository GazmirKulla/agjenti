"use client";
import { useCallback, useEffect, useState } from "react";
import type { ContinuationItem, ContinuationQuestion } from "@/lib/onboarding/continuation";
import "./profile-questions.css";

type View = { question: ContinuationQuestion | null; progress: { answered: number; total: number }; items: ContinuationItem[] };
type Answer = { values: string[] } | { text: string } | { skip: true };

/** The onboarding profile questions inside the "Gati për klientët" card: one
 * question at a time, with back, "Më vonë" and the answers given so far. The
 * server checks every answer; the card only shows and sends them. */
export function ProfileQuestions({ slug, onFinished, core = false }: {
  slug: string;
  onFinished: () => void;
  /** Onboarding: only the short questions; the details wait for the Home card. */
  core?: boolean;
}) {
  const path = `/api/business-onboarding?slug=${encodeURIComponent(slug)}`;
  const [view, setView] = useState<View | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  // The next question: the server's, or in onboarding the first short one still open.
  const nextField = useCallback((next: View) =>
    core ? next.items.find((entry) => entry.core && entry.status === "open")?.field ?? null : next.question?.field ?? null, [core]);
  const show = useCallback((full: View, at: string | null) => {
    const next = core ? { ...full, items: full.items.filter((entry) => entry.core) } : full;
    setView(next);
    setField(at);
    const item = next.items.find((entry) => entry.field === at);
    setValues(Array.isArray(item?.value) ? item.value : []);
    setText(typeof item?.value === "string" ? item.value : "");
    setError("");
  }, [core]);

  useEffect(() => {
    let live = true;
    fetch(path, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((data: { continuation: View | null }) => {
        if (!live) return;
        if (!data.continuation) { setLoadFailed(true); return; }
        const at = nextField(data.continuation);
        show(data.continuation, at);
        if (core && !at) onFinished();
      })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
    // onFinished is the caller's; loading again for a new callback would repeat the question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, show, nextField, core]);

  async function send(answer: Answer) {
    if (!field) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, answer }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.continuation) throw new Error(data.error || "Përgjigjja nuk u ruajt. Provo përsëri.");
      const next = data.continuation as View;
      const at = nextField(next);
      show(next, at);
      if (!at) onFinished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Përgjigjja nuk u ruajt. Provo përsëri.");
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed) return <p className="profile-q-note">Pyetjet e profilit nuk u ngarkuan. Rifresko faqen.</p>;
  if (!view) return <p className="profile-q-note" aria-busy="true">Duke ngarkuar pyetjet…</p>;

  const answered = view.items.filter((item) => item.status === "answered");
  const index = view.items.findIndex((item) => item.field === field);
  const item = index >= 0 ? view.items[index] : null;
  const choice = item && item.kind !== "text" && item.kind !== "list";
  const ready = choice ? values.length > 0 : text.trim().length > 0;

  return (
    <div className="profile-q">
      {item ? (
        <form className="profile-q-card" onSubmit={(event) => { event.preventDefault(); if (ready) void send(choice ? { values } : { text: text.trim() }); }}>
          <p className="profile-q-count">Pyetja {index + 1} nga {view.items.length}</p>
          <h3 id="profile-q-title">{item.title}</h3>
          {item.hint && <p className="profile-q-hint">{item.hint}</p>}
          {choice ? (
            <div className="profile-q-options" role={item.kind === "multiple" ? "group" : "radiogroup"} aria-labelledby="profile-q-title">
              {item.options.map((option) => {
                const on = values.includes(option.value);
                return (
                  <button key={option.value} type="button" role={item.kind === "multiple" ? "checkbox" : "radio"} aria-checked={on}
                    className={on ? "is-on" : undefined} disabled={busy}
                    onClick={() => setValues(item.kind === "multiple" ? (on ? values.filter((v) => v !== option.value) : [...values, option.value]) : [option.value])}>
                    <span className="profile-q-mark" aria-hidden="true">{on ? "✓" : ""}</span>{option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea className="field" rows={item.kind === "list" ? 4 : 3} maxLength={2000} value={text} disabled={busy}
              aria-labelledby="profile-q-title" placeholder={item.kind === "list" ? "Një në çdo rresht" : "Shkruaj përgjigjen"}
              onChange={(event) => setText(event.target.value)} />
          )}
          {item.kind === "multiple" && <p className="profile-q-hint">Mund të zgjedhësh më shumë se një.</p>}
          {error && <p className="profile-q-error" role="alert">{error}</p>}
          <div className="profile-q-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !ready}>{busy ? "Duke ruajtur…" : "Vazhdo"}</button>
            <button type="button" className="btn btn-ghost" disabled={busy || index <= 0} onClick={() => show(view, view.items[index - 1].field)}>Prapa</button>
            <button type="button" className="profile-q-later" disabled={busy} onClick={() => void send({ skip: true })}>Më vonë</button>
          </div>
        </form>
      ) : (
        <div className="profile-q-card">
          <h3>Profili u plotësua</h3>
          <p className="profile-q-hint">
            {view.items.some((entry) => entry.status === "skipped")
              ? "Disa pyetje i le për më vonë. Mund t'u përgjigjesh kur të duash më poshtë."
              : "Faleminderit. Mund të ndryshosh çdo përgjigje më poshtë."}
          </p>
        </div>
      )}
      {(answered.length > 0 || view.items.some((entry) => entry.status === "skipped")) && (
        <details className="profile-q-answers" open={!item}>
          <summary>Përgjigjet e tua ({answered.length} nga {view.items.length})</summary>
          <ul>
            {view.items.filter((entry) => entry.status !== "open" && entry.field !== field).map((entry) => (
              <li key={entry.field}>
                <span><strong>{entry.title}</strong>{entry.status === "answered" ? entry.answer : <em>Lënë për më vonë</em>}</span>
                <button type="button" className="profile-q-later" disabled={busy} onClick={() => show(view, entry.field)}>
                  {entry.status === "answered" ? "Ndrysho" : "Përgjigju"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
