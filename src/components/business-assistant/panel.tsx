"use client";
import { LinearWorkflowCard } from "./linear-workflow-card";
import type { LinearCard } from "@/lib/business-assistant/linear-service";
import {
  assistantSuggestions,
  contextLabel,
  type AssistantUIContext,
} from "@/lib/business-assistant/context";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AudioRecorder } from "@/components/onboarding/audio-recorder";
import { AssistantComposer } from "./composer";
import { Icon } from "@/components/dashboard/icon";
import type { Preview } from "@/lib/business-assistant/model";

import { OrderFlowCard } from "./orderflow-card";
import type { OrderFlowContext } from "@/lib/business-assistant/orderflow-service";
import { WorkflowCard } from "./workflow-card";
import type { WorkflowCard as WorkflowCardData } from "@/lib/business-assistant/workflow";

type Message = { role: "user" | "assistant"; content: string };
function MessageCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="assistant-message-copy"
      aria-label={copied ? "U kopjua" : "Kopjo mesazhin"}
      title={copied ? "U kopjua" : "Kopjo"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard may be unavailable */
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}
type Result = {
  choices?: string[];
  message?: string;
  preview?: Preview;
  workflow?: WorkflowCardData;
  orderflows?: OrderFlowContext;
  editableFlow?: boolean;
  linear?: LinearCard;
  token?: string;
  slots?: string[];
  transcript?: string;
  error?: string;
  saved?: boolean;
  path?: string;
};
export function BusinessAssistant({
  external,
  sendRef,
  slug,
  agentName,
  open,
  onClose,
  onOpen,
  modules,
  text,
  setText,
  mode,
  setMode,
  context,
  panelWidth,
  setPanelWidth,
}: {
  external: boolean;
  sendRef: React.RefObject<(() => void) | null>;
  slug: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  modules: string[];
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  mode: "text" | "audio";
  setMode: React.Dispatch<React.SetStateAction<"text" | "audio">>;
  context: AssistantUIContext;
  panelWidth: number;
  setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState<"plan" | "confirm" | "audio" | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [requestContext, setRequestContext] =
    useState<AssistantUIContext | null>(null);
  const lastContext = useRef("");
  const abort = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const [viewport, setViewport] = useState({ bottom: 0, height: 0 });
  useEffect(() => {
    const visual = window.visualViewport;
    const sync = () =>
      setViewport({
        bottom: visual
          ? Math.max(0, window.innerHeight - visual.height - visual.offsetTop)
          : 0,
        height: visual?.height ?? window.innerHeight,
      });
    sync();
    visual?.addEventListener("resize", sync);
    visual?.addEventListener("scroll", sync);
    return () => {
      visual?.removeEventListener("resize", sync);
      visual?.removeEventListener("scroll", sync);
    };
  }, []);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (el.open) el.close();
    if (open) {
      if (mobile) el.showModal();
      else el.show();
    }
  }, [open, mobile]);
  useEffect(() => {
    if (!open || !mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = previous;};
  }, [open,mobile]);
  useEffect(() => {
    if (open)
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [history, result, open]);
  async function request(body: FormData | Record<string, unknown>) {
    const response = await fetch(
      `/api/business-assistant?slug=${encodeURIComponent(slug)}`,
      {
        method: "POST",
        signal: abort.current.signal,
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      },
    );
    const data: Result = await response.json();
    if (abort.current.signal.aborted) throw new Error("Kërkesa u ndërpre.");
    if (!response.ok) throw new Error(data.error || "Kërkesa nuk përfundoi.");
    return data;
  }
  async function analyze(event?: React.FormEvent) {
    event?.preventDefault();
    if (locked.current || text.trim().length < 3) return;
    locked.current = true;
    setBusy("plan");
    setError("");
    setResult(null);
    const input = text.trim();
    setText("");
    const contextKey = `${slug}:${context.page}`;
    setRequestContext(context);
    try {
      const data = await request({
        mode: "plan",
        text: input,
        history: lastContext.current === contextKey ? history.slice(-6) : [],
        context,
        ...((result?.workflow?.proposed || result?.editableFlow || result?.linear) && result.token ? { pendingToken: result.token } : {}),
      });
      lastContext.current = contextKey;
      setHistory((prev) => [
        ...prev.slice(-78),
        { role: "user", content: input },
        { role: "assistant", content: data.message || "Kontrollo propozimin." },
      ]);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kërkesa nuk përfundoi.");
      setText((current) => (current.trim() ? current : input));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  useEffect(() => {
    sendRef.current = () => {
      setMode("text");
      onOpen();
      void analyze();
    };
    return () => {
      sendRef.current = null;
    };
  });
  async function confirm() {
    if (locked.current || !result?.token) return;
    locked.current = true;
    setBusy("confirm");
    setError("");
    try {
      const data = await request({ mode: "confirm", token: result.token });
      setResult(data);
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: data.message || "Ndryshimi u ruajt." },
      ]);
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
    <>
      {!open && (
        <section
          className="assistant-mobile-dock"
          aria-label={agentName}
          style={{ bottom: viewport.bottom }}
        >
          <AssistantComposer id="assistant-dock-input" value={text} busy={Boolean(busy)} onOpen={onOpen}
            onChange={(value) => { setText(value); if (result?.token && !result.workflow && !result.editableFlow && !result.linear) setResult(null); }}
            onSubmit={() => { onOpen(); setMode("text"); void analyze(); }}
            onVoice={() => { setMode("audio"); onOpen(); }} />
          <span className="assistant-dock-hint">
            {busy
              ? "Agjenti po punon…"
              : result?.token
                ? "Propozimi është gati · hap bisedën për konfirmim"
                : "Ndryshimet i konfirmon ti."}
          </span>
        </section>
      )}
      <dialog
        ref={dialog}
        className={`business-assistant assistant-workspace-panel ${context.page === "home" ? "is-home" : ""} ${expanded ? "is-expanded" : ""} ${mode === "audio" ? "is-voice" : ""}`}
        style={
          {
            "--assistant-panel-width": `${panelWidth}px`,
            "--assistant-viewport-height": `${viewport.height || 800}px`,
            "--assistant-keyboard-bottom": `${viewport.bottom}px`,
          } as React.CSSProperties
        }
        aria-labelledby="business-assistant-title"
        onCancel={onClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="assistant-heading">
          <span className="assistant-mark">
            <Icon name="spark" size={24} />
          </span>
          <div>
            <h2 id="business-assistant-title">{agentName}</h2>
            <p>
              Agjenti · {contextLabel(context)}
              {context.entityId ? " · Elementi i zgjedhur" : ""}
            </p>
          </div>
          {mobile && (
            <button
              type="button"
              className="assistant-expand"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Zvogëlo bisedën" : "Zgjero bisedën"}
            >
              {expanded ? "↙" : "↗"}
            </button>
          )}
          <button
            type="button"
            className="assistant-close"
            onClick={onClose}
            aria-label={`Mbyll ${agentName}`}
          >
            ×
          </button>
        </header>
        {!mobile && (
          <label className="assistant-panel-resize">
            Gjerësia e panelit
            <input
              type="range"
              min="360"
              max="600"
              step="20"
              value={panelWidth}
              onChange={(e) => setPanelWidth(Number(e.target.value))}
            />
          </label>
        )}
        <div className={`assistant-body ${!history.length && !result && !error ? "is-empty" : ""}`} aria-busy={Boolean(busy)}>
          {mode === "text" && !history.length && !result && (
            <div className="assistant-welcome">
              <h3>Çfarë dëshiron të ndryshosh?</h3>
              <p>
                Menaxho produktet, shërbimet, njohuritë dhe takimet me një
                kërkesë.
              </p>
              <div className="assistant-examples">
                {assistantSuggestions(context, modules, external).map(
                  ({ text: example }) => (
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
                  ),
                )}
              </div>
            </div>
          )}
          <div
            className="assistant-conversation"
            role="log"
            aria-label={`Biseda me ${agentName}`}
          >
            {history.map((message, i) => (
              <div
                key={i}
                className={`assistant-message assistant-message-${message.role}`}
              >
                <p>{message.content}</p>
                {message.role === "assistant" && (
                  <div className="assistant-message-actions">
                    <MessageCopy text={message.content} />
                  </div>
                )}
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
          {result?.orderflows && <OrderFlowCard data={result.orderflows} slug={slug} onRequest={value => {setMode("text");setText(value);}} />}
          {result?.choices?.length ? <div className="assistant-quick-actions">{result.choices.map(choice=><button type="button" key={choice} disabled={Boolean(busy)} onClick={()=>{setMode("text");setText(choice);}}>{choice}</button>)}</div> : null}
          {result?.workflow && <WorkflowCard key={JSON.stringify(result.workflow)} data={result.workflow} slug={slug} pending={Boolean(result.token)} onRequest={value => { setMode("text"); setText(value); }} />}
          {result?.linear && <LinearWorkflowCard data={result.linear} slug={slug} pending={Boolean(result.token)} onRequest={value=>{setMode("text");setText(value);}} />}
          {result?.preview && (
            <section
              className="assistant-preview"
              aria-label="Ndryshimet për konfirmim"
            >
              <div className="assistant-preview-heading">
                <span>
                  GATI PËR KONTROLL
                  {requestContext ? ` · ${contextLabel(requestContext)}` : ""}
                </span>
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
                  {busy === "confirm" ? "Po ruhet…" : result.workflow ? result.preview.title : "Konfirmo ndryshimin"}
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
            {mode === "audio" ? <button type="button" className="assistant-write-instead" disabled={Boolean(busy)} onClick={() => setMode("text")}>
              <Icon name="edit" size={16} /> Shkruaj
            </button> : <small>Ndryshimet i konfirmon ti.</small>}
            <button type="button" className="assistant-reset assistant-reset-icon" onClick={reset} disabled={Boolean(busy)} aria-label="Bisedë e re" title="Bisedë e re">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          {mode === "text" ? (
            <AssistantComposer id="business-assistant-input" value={text} busy={Boolean(busy)} multiline
              onChange={(value) => { setText(value); if (result?.token && !result.workflow && !result.editableFlow && !result.linear) setResult(null); }}
              onSubmit={() => void analyze()} onVoice={() => setMode("audio")} />
          ) : (
            open && <AudioRecorder variant="assistant" purpose="request" busy={Boolean(busy)} onAnalyze={transcribe} analyzeLabel="Ktheje në tekst" />
          )}
        </div>
      </dialog>
    </>
  );
}
