"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AudioRecorder } from "@/components/onboarding/audio-recorder";
import { Icon } from "@/components/dashboard/icon";
import type { Preview } from "@/lib/business-assistant/model";

type Message = { role: "user" | "assistant"; content: string };
type Result = {
  message?: string;
  preview?: Preview;
  token?: string;
  slots?: string[];
  transcript?: string;
  error?: string;
  saved?: boolean;
  path?: string;
};
export function BusinessAssistant({
  slug,
  open,
  onClose,
  modules,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  modules: string[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [busy, setBusy] = useState<"plan" | "confirm" | "audio" | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (open)
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [history, result, open]);
  async function request(body: FormData | Record<string, unknown>) {
    const response = await fetch(
      `/api/business-assistant?slug=${encodeURIComponent(slug)}`,
      {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      },
    );
    const data: Result = await response.json();
    if (!response.ok) throw new Error(data.error || "Kërkesa nuk përfundoi.");
    return data;
  }
  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || text.trim().length < 3) return;
    locked.current = true;
    setBusy("plan");
    setError("");
    setResult(null);
    const input = text.trim();
    try {
      const data = await request({
        mode: "plan",
        text: input,
        history: history.slice(-6),
      });
      setHistory((prev) => [
        ...prev.slice(-6),
        { role: "user", content: input },
        { role: "assistant", content: data.message || "Kontrollo propozimin." },
      ]);
      setText("");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kërkesa nuk përfundoi.");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function confirm() {
    if (locked.current || !result?.token) return;
    locked.current = true;
    setBusy("confirm");
    setError("");
    try {
      const data = await request({ mode: "confirm", token: result.token });
      setResult(data);
      setHistory([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ruajtja nuk përfundoi.");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function transcribe(file: File) {
    if (locked.current) return;
    locked.current = true;
    setBusy("audio");
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.set("audio", file);
      body.set("answers", "{}");
      const data = await request(body);
      setText(data.transcript || "");
      setMode("text");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audioja nuk u lexua.");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  function reset() {
    setHistory([]);
    setResult(null);
    setText("");
    setError("");
    setMode("text");
  }
  return (
    <dialog
      ref={dialog}
      className="business-assistant"
      aria-labelledby="business-assistant-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="assistant-heading">
        <span className="assistant-mark">
          <Icon name="spark" size={24} />
        </span>
        <div>
          <h2 id="business-assistant-title">Asistenti i biznesit</h2>
          <p>Thuaje. Kontrolloje. Konfirmoje.</p>
        </div>
        <button
          type="button"
          className="assistant-close"
          onClick={onClose}
          aria-label="Mbyll asistentin"
        >
          ×
        </button>
      </header>
      <div className="assistant-body" aria-busy={Boolean(busy)}>
        {!history.length && !result && (
          <div className="assistant-welcome">
            <h3>Çfarë dëshiron të ndryshosh?</h3>
            <p>
              Menaxho produktet, shërbimet, njohuritë dhe takimet me një
              kërkesë.
            </p>
            <div className="assistant-examples">
              {[
                ...(modules.includes("products")
                  ? ["Ndrysho çmimin e një produkti"]
                  : []),
                ...(modules.includes("services")
                  ? ["Shto një shërbim të ri"]
                  : []),
                ...(modules.includes("knowledge")
                  ? ["Përditëso njohuritë e biznesit"]
                  : []),
                ...(modules.includes("bookings")
                  ? ["Gjej një orar të lirë për takim"]
                  : []),
              ].map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => {
                    setText(example);
                    setMode("text");
                  }}
                  disabled={Boolean(busy)}
                >
                  <Icon name="spark" size={16} />
                  {example}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="assistant-conversation"
          role="log"
          aria-label="Biseda me asistentin"
        >
          {history.map((message, i) => (
            <div
              key={i}
              className={`assistant-message assistant-message-${message.role}`}
            >
              <small>{message.role === "user" ? "Ti" : "Asistenti"}</small>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
        {result?.slots && (
          <div className="assistant-slots" aria-label="Oraret e lira">
            {result.slots.map((time) => (
              <button
                type="button"
                key={time}
                disabled={Boolean(busy)}
                onClick={() => {
                  setText(`Dua takim në orën ${time}. `);
                  setMode("text");
                }}
              >
                {time}
              </button>
            ))}
          </div>
        )}
        {result?.preview && (
          <section
            className="assistant-preview"
            aria-label="Ndryshimet për konfirmim"
          >
            <div className="assistant-preview-heading">
              <span>GATI PËR KONTROLL</span>
              <h3>{result.preview.title}</h3>
              {result.preview.subject && (
                <p className="assistant-subject">{result.preview.subject}</p>
              )}
            </div>
            <dl>
              {result.preview.fields.map((field, i) => (
                <div key={i}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.before !== "—" && (
                      <span className="assistant-before">{field.before}</span>
                    )}
                    <span className="assistant-after">{field.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {result.preview.notice && (
              <p className="assistant-notice">{result.preview.notice}</p>
            )}
            <p className="assistant-notice">
              Asgjë nuk është ruajtur ende. Konfirmimi vlen për 10 minuta.
            </p>
            <div className="assistant-preview-actions">
              <button
                type="button"
                className="assistant-primary"
                onClick={confirm}
                disabled={Boolean(busy)}
              >
                {busy === "confirm" ? "Po ruhet…" : "Konfirmo ndryshimin"}
              </button>
              <button
                type="button"
                className="assistant-secondary"
                disabled={Boolean(busy)}
                onClick={() => {
                  setResult(null);
                  setHistory((prev) => [
                    ...prev,
                    {
                      role: "assistant",
                      content: "Propozimi u anulua; asgjë nuk u ruajt.",
                    },
                  ]);
                }}
              >
                Anulo
              </button>
            </div>
          </section>
        )}
        {result?.saved && (
          <div className="assistant-success" role="status">
            <Icon name="check" size={22} />
            <div>
              <strong>{result.message}</strong>
              {result.path && (
                <Link href={`/b/${slug}/${result.path}`} onClick={onClose}>
                  Shiko ndryshimin →
                </Link>
              )}
            </div>
          </div>
        )}
        {error && (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="assistant-working" role="status">
            {busy === "audio"
              ? "Po kthej audion në tekst…"
              : busy === "confirm"
                ? "Po ruaj ndryshimin…"
                : "Po analizoj kërkesën dhe të dhënat…"}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="assistant-composer">
        <div className="assistant-composer-top">
          <div
            className="assistant-modes"
            role="group"
            aria-label="Mënyra e përgjigjes"
          >
            <button
              type="button"
              aria-pressed={mode === "text"}
              disabled={Boolean(busy)}
              onClick={() => setMode("text")}
            >
              <Icon name="edit" size={16} />
              Tekst
            </button>
            <button
              type="button"
              aria-pressed={mode === "audio"}
              disabled={Boolean(busy)}
              onClick={() => setMode("audio")}
            >
              <Icon name="microphone" size={16} />
              Audio
            </button>
          </div>
          <button
            type="button"
            className="assistant-reset"
            onClick={reset}
            disabled={Boolean(busy)}
          >
            Kërkesë e re
          </button>
        </div>
        {mode === "text" ? (
          <form onSubmit={analyze}>
            <label className="sr-only" htmlFor="business-assistant-input">
              Kërkesa jote
            </label>
            <textarea
              id="business-assistant-input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (result?.token) setResult(null);
              }}
              maxLength={12000}
              rows={3}
              placeholder="P.sh. Ndrysho çmimin e barrierës në 45 EUR…"
              disabled={Boolean(busy)}
            />
            <div className="assistant-send-row">
              <small>Çdo ndryshim kërkon konfirmimin tënd.</small>
              <button
                type="submit"
                className="assistant-primary"
                disabled={Boolean(busy) || text.trim().length < 3}
              >
                Analizo <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
        ) : (
          open && (
            <AudioRecorder
              purpose="request"
              busy={Boolean(busy)}
              onAnalyze={transcribe}
              analyzeLabel="Ktheje në tekst"
            />
          )
        )}
      </div>
    </dialog>
  );
}
