"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Answers,
  type AnswerKey,
  parseAnswers,
} from "@/lib/onboarding/model";
import {
  conversationQuestions,
  conversationSummary,
  nextConversationQuestion,
} from "@/lib/onboarding/conversation";
import { correctField } from "@/lib/onboarding/audio-model";
import { saveOnboarding } from "@/lib/onboarding/actions";
import { signOut } from "@/lib/auth/actions";
import { AudioRecorder } from "./audio-recorder";
import { TalkingRobot } from "@/components/business-assistant/talking-robot";

type Message = { role: "agent" | "user"; text: string };
export function ConversationOnboarding({
  initial,
  email,
  enabledSteps,
}: {
  initial: Answers;
  email: string;
  enabledSteps: AnswerKey[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initial);
  const [messages, setMessages] = useState<Message[]>([]);
  const [skipped, setSkipped] = useState<string[]>(initial.conversationSkipped ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [audio, setAudio] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const question = editing
    ? (conversationQuestions(answers, enabledSteps).find(
        (q) => q.field === editing,
      ) ?? null)
    : nextConversationQuestion(answers, enabledSteps, skipped);
  const summary = conversationSummary(answers, enabledSteps);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  useEffect(() => {
    setSelected([]);
  }, [question?.field]);
  async function store(next: Answers, message: string) {
    next = {...next, conversationSkipped: next.conversationSkipped ?? skipped};
    const result = await saveOnboarding(next, 7);
    if (result.error) throw new Error(result.error);
    if (result.destination) {
      router.push(result.destination);
      return;
    }
    setAnswers(next);
    setEditing(null);
    setText("");
    setAudio(false);
    setMessages((old) => [
      ...old,
      ...(question ? [{ role: "agent" as const, text: question.title }] : []),
      { role: "user", text: message },
    ]);
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Nuk u ruajt përgjigjja. Provo përsëri.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function analyze(file?: File) {
    await run(async () => {
      const body = file ? new FormData() : null;
      if (body && file) {
        body.set("audio", file);
        body.set("answers", JSON.stringify(answers));
      }
      const response = await fetch(
        `/api/onboarding/conversation${question ? `?field=${encodeURIComponent(question.field)}` : ""}`,
        {
          method: "POST",
          headers: body ? undefined : { "Content-Type": "application/json" },
          body: body ?? JSON.stringify({ text, answers }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Analiza nuk përfundoi. Provo përsëri.");
      await store(
        parseAnswers(data.answers, false, enabledSteps),
        data.transcript,
      );
    });
  }
  function choose(values: string[]) {
    if (!question) return;
    void run(() =>
      store(
        correctField(
          answers,
          question.field,
          ["hasVariants", "isPersonalized", "sellsProducts"].includes(
            question.field,
          )
            ? values[0] === "true"
            : question.field === "offeringTypes" || question.multiple
              ? values
              : values[0],
        ),
        values
          .map(
            (value) =>
              question.options.find((o) => o.value === value)?.label ?? value,
          )
          .join(", "),
      ),
    );
  }
  async function complete() {
    await run(async () => {
      const next = {
        ...answers,
        audioReview: answers.audioReview
          ? {
              ...answers.audioReview,
              reviewed: true,
              confirmedFields: [
                ...new Set([
                  ...answers.audioReview.confirmedFields,
                  ...Object.keys(answers.audioReview.confidence),
                ]),
              ],
            }
          : undefined,
      };
      const result = await saveOnboarding(next, 7, true);
      if (result.error) throw new Error(result.error);
      if (result.destination) router.push(result.destination);
    });
  }
  return (
    <main className="onboarding-page conversation-page">
      <section className="onboarding-chat">
        <header className="onboarding-chat-header">
          <span className="onboarding-chat-avatar">
            <TalkingRobot />
          </span>
          <div>
            <span className="onboarding-eyebrow">LE TA NISIM BASHKË</span>
            <h1>
              {answers.name
                ? `Agjenti “${answers.name}”`
                : "Agjenti i biznesit tënd"}
            </h1>
            <p>
              Ma trego me fjalët e tua. Unë përgatis profilin, ti e konfirmon.
            </p>
          </div>
        </header>
        <div
          className="onboarding-chat-thread"
          aria-live="polite"
          aria-busy={busy}
        >
          <div className="onboarding-chat-bubble">
            Përshëndetje! Do të të ndihmoj të krijosh hapësirën e biznesit. Mund
            të përgjigjesh me tekst, audio ose të zgjedhësh një nga
            alternativat.
          </div>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`onboarding-chat-bubble ${m.role === "user" ? "is-user" : ""}`}
            >
              {m.text}
            </div>
          ))}
          {question ? (
            <div className="onboarding-chat-question" key={question.field}>
              <h2>{question.title}</h2>
              <p>{question.hint}</p>
              {question.confirm && (
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const review = answers.audioReview!;
                      await store(
                        {
                          ...answers,
                          audioReview: {
                            ...review,
                            confirmedFields: [
                              ...new Set([
                                ...review.confirmedFields,
                                question.field,
                              ]),
                            ],
                          },
                        },
                        "Po, është e saktë.",
                      );
                    })
                  }
                >
                  Po, është e saktë
                </button>
              )}
              <div className="onboarding-chat-options">
                {question.options.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    disabled={busy}
                    aria-pressed={selected.includes(option.value)}
                    onClick={() =>
                      question.multiple
                        ? setSelected((old) =>
                            old.includes(option.value)
                              ? old.filter((v) => v !== option.value)
                              : [...old, option.value],
                          )
                        : choose([option.value])
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {question.multiple && (
                <button
                  className="btn btn-primary"
                  disabled={busy || !selected.length}
                  onClick={() => choose(selected)}
                >
                  Vazhdo me zgjedhjet
                </button>
              )}
              {question.optional && !question.confirm && (
                <button
                  className="onboarding-chat-skip"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const nextSkipped = [...skipped, question.field];
                      await store({...answers, conversationSkipped:nextSkipped}, 'E plotësoj më vonë.');
                      setSkipped(nextSkipped);
                    });
                  }}
                >
                  E plotësoj më vonë
                </button>
              )}
            </div>
          ) : (
            <div className="onboarding-chat-question">
              <h2>Profili yt është gati për konfirmim</h2>
              <p>
                Kontrollo përmbledhjen më poshtë. Mund të korrigjosh çdo
                përgjigje para krijimit.
              </p>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={complete}
              >
                Konfirmo dhe krijo hapësirën
              </button>
            </div>
          )}
          {busy && <p role="status">Po përpunoj përgjigjen…</p>}
          <div ref={bottom} />
        </div>
        {error && (
          <p className="onboarding-chat-error" role="alert">
            {error}
          </p>
        )}
        <div className="onboarding-chat-composer">
          <div className="onboarding-chat-modes">
            <button
              disabled={busy}
              aria-pressed={!audio}
              onClick={() => setAudio(false)}
            >
              Tekst
            </button>
            <button
              disabled={busy}
              aria-pressed={audio}
              onClick={() => setAudio(true)}
            >
              Audio
            </button>
          </div>
          {audio ? (
            <AudioRecorder
              busy={busy}
              onAnalyze={analyze}
              purpose="request"
              analyzeLabel="Dërgo përgjigjen"
              questions={
                question
                  ? [
                      {
                        id: question.field,
                        title: question.title,
                        hint: question.hint,
                      },
                    ]
                  : []
              }
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void analyze();
              }}
            >
              <label className="sr-only" htmlFor="onboarding-chat-answer">
                Përgjigjja jote
              </label>
              <textarea
                id="onboarding-chat-answer"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                maxLength={12000}
                rows={3}
                placeholder="Shkruaj përgjigjen ose shto një detaj…"
              />
              <button
                className="btn btn-primary"
                disabled={busy || !text.trim()}
              >
                Dërgo përgjigjen →
              </button>
            </form>
          )}
        </div>
        {summary.length > 0 && (
          <details className="onboarding-chat-summary" open={!question}>
            <summary>Profili që po ndërtojmë · {summary.length} detaje</summary>
            <dl>
              {summary.map((row) => (
                <div key={row.field}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                  {conversationQuestions(answers, enabledSteps).some(
                    (q) => q.field === row.field,
                  ) && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(row.field);
                        setText("");
                      }}
                    >
                      Ndrysho
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </details>
        )}
        <footer className="onboarding-chat-footer">
          <span>{email}</span>
          <form action={signOut}>
            <button>Dil nga llogaria</button>
          </form>
        </footer>
      </section>
    </main>
  );
}
