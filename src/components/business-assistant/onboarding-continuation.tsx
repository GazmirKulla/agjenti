"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/dashboard/icon";
import type {
  ContinuationAnswer,
  ContinuationProgress,
  ContinuationQuestion,
} from "@/lib/onboarding/continuation";

type View = { question: ContinuationQuestion | null; progress: ContinuationProgress; profileChanged?: boolean };

/** The agent continues onboarding on Home: one open question at a time, for
 * everything the manual flow left empty or the person skipped. */
export function OnboardingContinuation({ slug, agentName, disabled }: { slug: string; agentName: string; disabled?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const lock = useRef(false);
  const url = `/api/business-onboarding?slug=${encodeURIComponent(slug)}`;

  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (active && data?.continuation) setView(data.continuation); })
      .catch(() => { /* The assistant stays usable without onboarding questions. */ });
    return () => { active = false; };
  }, [url]);

  const field = view?.question?.field;
  useEffect(() => { setSelected([]); setText(""); setError(""); }, [field]);

  async function send(answer: ContinuationAnswer) {
    if (!view?.question || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: view.question.field, answer }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.continuation) throw new Error(data.error || "Përgjigjja nuk u ruajt. Provo përsëri.");
      const next: View = data.continuation;
      if (!next.question && !("skip" in answer)) setFinished(true);
      setView(next);
      if (next.profileChanged) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Përgjigjja nuk u ruajt. Provo përsëri.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (finished && !view?.question)
    return (
      <section className="onboarding-continuation" aria-live="polite">
        <p className="onboarding-continuation-eyebrow"><Icon name="spark" size={14} /> {agentName}</p>
        <p className="onboarding-continuation-title">Faleminderit! Profili i biznesit u plotësua.</p>
        <p className="onboarding-continuation-hint">Përgjigjet i gjen dhe i ndryshon te profili i biznesit.</p>
      </section>
    );
  const question = view?.question;
  if (!question) return null;
  const off = busy || disabled;
  const { answered, total } = view.progress;
  return (
    <section className="onboarding-continuation" aria-labelledby="onboarding-continuation-title" aria-busy={busy}>
      <div className="onboarding-continuation-head">
        <p className="onboarding-continuation-eyebrow"><Icon name="spark" size={14} /> {agentName} · Le ta plotësojmë profilin</p>
        <span>{answered} / {total}</span>
      </div>
      <progress max={total || 1} value={answered} aria-label="Progresi i profilit të biznesit" />
      <p className="onboarding-continuation-title" id="onboarding-continuation-title">{question.title}</p>
      {question.hint && <p className="onboarding-continuation-hint">{question.hint}</p>}
      {question.kind === "text" || question.kind === "list" ? (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send({ text }); }}>
          <label className="sr-only" htmlFor="onboarding-continuation-answer">Përgjigjja jote</label>
          <textarea
            id="onboarding-continuation-answer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={off}
            maxLength={2000}
            rows={3}
            placeholder={question.kind === "list" ? "Një element për rresht…" : "Shkruaj përgjigjen…"}
          />
          <div className="onboarding-continuation-actions">
            <button type="button" className="onboarding-continuation-skip" disabled={off} onClick={() => void send({ skip: true })}>Më vonë</button>
            <button type="submit" className="btn btn-primary" disabled={off || !text.trim()}>Ruaj përgjigjen</button>
          </div>
        </form>
      ) : (
        <>
          <div className="onboarding-continuation-options" role={question.kind === "multiple" ? "group" : undefined} aria-labelledby="onboarding-continuation-title">
            {question.options.map((option) => (
              <button
                type="button"
                key={option.value}
                disabled={off}
                aria-pressed={question.kind === "multiple" ? selected.includes(option.value) : undefined}
                onClick={() =>
                  question.kind === "multiple"
                    ? setSelected((old) => old.includes(option.value) ? old.filter((v) => v !== option.value) : [...old, option.value])
                    : void send({ values: [option.value] })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="onboarding-continuation-actions">
            <button type="button" className="onboarding-continuation-skip" disabled={off} onClick={() => void send({ skip: true })}>Më vonë</button>
            {question.kind === "multiple" && (
              <button type="button" className="btn btn-primary" disabled={off || !selected.length} onClick={() => void send({ values: selected })}>Vazhdo</button>
            )}
          </div>
        </>
      )}
      {busy && <p role="status" className="onboarding-continuation-hint">Po ruhet…</p>}
      {error && <p role="alert" className="onboarding-continuation-error">{error}</p>}
    </section>
  );
}
