"use client";
import "./workspace-layout.css";
import "./mobile.css";
import "./one-migo.css";
import { businessGoals } from "./presentation";
import { AssistantHistory, useAssistantHistory } from "./history";
import { hasRecoverableWork, type ConversationView } from "@/lib/business-assistant/persistence-model";
import { AssistantAppearanceDialog, PersonalAssistantAvatar, PersonalAssistantWidget } from "./personal-assistant";
import type { AssistantAppearance } from "./appearance";
import { createPortal } from "react-dom";
import { ProductCsvImport } from "@/components/dashboard/product-csv-import";
import type { ImportSource } from "@/lib/products/import-model";
import { LinearWorkflowCard } from "./linear-workflow-card";
import { ActionPlanReview } from "./action-plan";
import { refreshPlanCapability, type ActionPlan } from "@/lib/business-assistant/action-plan";
import type { LinearCard } from "@/lib/business-assistant/linear-service";
import {
  contextLabel,
  type AssistantUIContext,
} from "@/lib/business-assistant/context";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileCard } from "./file-card";
import { AudioRecorder, primeVoiceCapture } from "@/components/onboarding/audio-recorder";
import { AssistantComposer } from "./composer";
import { Icon } from "@/components/dashboard/icon";
import type { Preview } from "@/lib/business-assistant/model";

import { OrderFlowCard } from "./orderflow-card";
import type { OrderFlowContext } from "@/lib/business-assistant/orderflow-service";
import { WorkflowCard } from "./workflow-card";
import { WorkflowChangeReview } from "@/components/workflows/workflow-change-review";
import { PublicationReceiptView } from "@/components/workflows/publication-readiness";
import type { WorkflowCard as WorkflowCardData } from "@/lib/business-assistant/workflow";

import { assistantContextKey, pinnedWorkflowContext, continuesWorkflowRequest, workflowRequestHistory, type WorkflowRequestPin } from "./request-context";

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
  persistence?: ConversationView;
  recovered?: boolean;
  actionPlan?: ActionPlan;
  publication?: import("@/lib/workflows/visual/publication-types").PublicationReadiness;
  receipt?: import("@/lib/workflows/visual/publication-types").PublicationReceipt;
  warning?: string;
  productImport?: ImportSource;
  clarifying?: boolean;
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
  materialDraft,
  external,
  sendRef,
  slug,
  agentName,
  businessName,
  appearance,
  saveAppearance,
  open,
  onClose,
  onOpen,
  modules,
  text,
  setText,
  mode,
  setMode,
  context,
  selectionLabel,
  panelWidth,
  setPanelWidth,
  requestKey = 0,
  userId,
  userName,
  historyOpen,
  onHistoryClose,
  onHistoryOpen,
  resetRef,
}: {
  materialDraft: ReturnType<typeof import("./materials").useMaterialDraft>;
  external: boolean;
  requestKey?: number;
  userId: string;
  userName?: string;
  historyOpen: boolean;
  onHistoryClose: () => void;
  onHistoryOpen: () => void;
  resetRef: React.RefObject<(() => void) | null>;
  sendRef: React.RefObject<(() => void) | null>;
  slug: string;
  agentName: string;
  businessName: string;
  appearance: AssistantAppearance;
  saveAppearance: (value: AssistantAppearance) => string | null;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  modules: string[];
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  mode: "text" | "audio";
  setMode: React.Dispatch<React.SetStateAction<"text" | "audio">>;
  context: AssistantUIContext;
  selectionLabel?: string;
  panelWidth: number;
  setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
}) {
  const { materials, setMaterials, addFiles, addLink, removeMaterial, setSending, materialError, setMaterialError } = materialDraft;
  const materialProps = { items: materials, onFiles: addFiles, onLink: addLink, onRemove: removeMaterial };
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  const [workOpen, setWorkOpen] = useState(false);
  const workBack = useRef<HTMLButtonElement>(null);
  const workTrigger = useRef<HTMLButtonElement>(null);
  const composerRegion = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState<"plan" | "confirm" | "audio" | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [launcherTarget, setLauncherTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setLauncherTarget(document.getElementById("personal-assistant-slot")); }, []);
  const archive = useAssistantHistory(userId, slug);
  const { history, setHistory } = archive;
  const [result, setResult] = useState<Result | null>(null);
  const [recovered, setRecovered] = useState(false);
  const sendAttempt = useRef<{ key: string; id: string } | null>(null);
  const [error, setError] = useState("");
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const inline = context.page === "home";
  const Greeting = inline ? "h1" : "h3";
  const visible = open || inline;
  const [expanded, setExpanded] = useState(false);
  const [requestContext, setRequestContext] =
    useState<AssistantUIContext | null>(null);
  const lastContext = useRef("");
  const [requestLabel, setRequestLabel] = useState<string>();
  const previousMaterials = useRef<{ context: string; tokens: string[]; links: string[] } | null>(null);
  const workflowRequest = useRef<WorkflowRequestPin | null>(null);
  const requestGeneration = useRef(0);
  const recoveredView = useRef(archive.view);
  recoveredView.current = archive.view;
  useEffect(() => {
    const view = recoveredView.current;
    const snapshot = view?.plan?.snapshot;
    if (view?.messages.some(message => message.request_id === sendAttempt.current?.id && message.role === "assistant"))
      sendAttempt.current = null;
    requestGeneration.current++;
    workflowRequest.current = null;
    previousMaterials.current = null;
    lastContext.current = snapshot?.context ? assistantContextKey(slug, snapshot.context) : "";
    setRequestContext(snapshot?.context ?? null);
    setResult(snapshot ? { message: snapshot.message, preview: snapshot.preview, actionPlan: snapshot.actionPlan } : null);
    setRecovered(hasRecoverableWork(snapshot));
  }, [archive.restoration, slug]);
  useEffect(() => {
    requestGeneration.current++;
    workflowRequest.current = null;
    previousMaterials.current = null;
    lastContext.current = "";
    setRequestContext(null);
    setResult(null);
  }, [requestKey, slug]);
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
    // Keep an open review above the assistant when switching to its mobile modal.
    const childModals = Array.from(el.querySelectorAll<HTMLDialogElement>("dialog:modal"));
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const retainFocus = wasVisible.current && focused && el.contains(focused);
    if (visible && !inline && !wasVisible.current) returnFocus.current = focused;
    childModals.forEach(child => child.close());
    if (el.open) el.close();
    if (visible) {
      if (mobile && !inline) el.showModal();
      else el.show();
      // Opening the home surface is not a request to focus an action or keyboard.
      if (inline && !childModals.length && !retainFocus && document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) document.activeElement.blur();
      childModals.forEach(child => child.showModal());
      if (childModals.some(child => focused && child.contains(focused))) focused?.focus();
      else if (retainFocus) focused.focus({ preventScroll: true });
      else if (!inline && !wasVisible.current) composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } else if (wasVisible.current && returnFocus.current?.isConnected) {
      returnFocus.current.focus();
    }
    wasVisible.current = visible;
  }, [visible, mobile, inline]);
  useEffect(() => {
    if (!visible || !mobile || inline) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = previous;};
  }, [visible, mobile, inline]);
  useEffect(() => {
    if (visible) {
      const plan = result?.actionPlan ? dialog.current?.querySelector(".action-plan") : null;
      const body = plan?.closest<HTMLElement>(".assistant-body");
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      if (plan && body) {
        // Scroll the conversation, not Home behind its sticky mobile header.
        body.scrollTo({
          top: body.scrollTop + plan.getBoundingClientRect().top - body.getBoundingClientRect().top - parseFloat(getComputedStyle(body).paddingTop),
          behavior,
        });
      } else end.current?.scrollIntoView({ block: "nearest", behavior });
    }
  }, [history, result, visible, outgoing, busy]);
  useEffect(() => {
    if (mobile && workOpen && result?.preview) workBack.current?.focus();
  }, [mobile, workOpen, result?.preview]);
  function returnToConversation() {
    setWorkOpen(false);
    requestAnimationFrame(() => workTrigger.current?.focus());
  }
  async function request(body: FormData | Record<string, unknown>) {
    const response = await fetch(
      `/api/business-assistant?slug=${encodeURIComponent(slug)}`,
      {
        method: "POST",
        signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(100000)]),
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
    if (!response.ok) {
      if (data.publication) setResult(previous => previous ? { ...previous, token: undefined, publication: data.publication,
        workflow: previous.workflow ? { ...previous.workflow, publication: data.publication } : undefined } : { publication: data.publication });
      throw new Error(data.error || "Kërkesa nuk përfundoi.");
    }
    if (data.persistence) archive.accept(data.persistence, Boolean(data.recovered));
    return data;
  }
  async function analyze(event?: React.FormEvent) {
    event?.preventDefault();
    if (locked.current || (!text.trim() && !materials.length)) return;
    locked.current = true;
    archive.inFlight.current = true;
    setWorkOpen(false);
    setBusy("plan");
    setSending(true);
    setError("");
    setResult(null);
    const input = text.trim();
    setText("");
    setOutgoing(input || null);
    const contextKey = assistantContextKey(slug, context);
    const generation = requestGeneration.current;
    const pin = workflowRequest.current?.scope === contextKey ? workflowRequest.current : null;
    const effectiveContext = pinnedWorkflowContext(context, pin);
    const materialContext = `${slug}:${JSON.stringify(effectiveContext)}`;
    setRequestContext(effectiveContext);
    if (!pin) setRequestLabel(selectionLabel);
    if (effectiveContext.page === "workflows" && effectiveContext.workflowSelection) workflowRequest.current = pin ?? { scope: contextKey, context: effectiveContext, history: [] };
    try {
      const conversation = await archive.ensureConversation();
      const attemptKey = JSON.stringify([conversation.id, input, effectiveContext, materials.map(m => m.name)]);
      if (sendAttempt.current?.key !== attemptKey) sendAttempt.current = { key: attemptKey, id: crypto.randomUUID() };
      const tokens: string[] = [];
      for (const item of materials) {
        if (!item.file) continue;
        if (item.token) { tokens.push(item.token); continue; }
        setMaterials(current => current.map(m => m.id === item.id ? { ...m, status: "Po ngarkohet dhe lexohet…" } : m));
        const form = new FormData(); form.set("file", item.file);
        const response = await fetch(`/api/business-assistant/upload?slug=${encodeURIComponent(slug)}`, { method: "POST", body: form, signal: abort.current.signal });
        const uploaded = await response.json();
        if (!response.ok || !uploaded.attachment?.token) throw new Error(uploaded.error || "Skedari nuk u ngarkua.");
        tokens.push(uploaded.attachment.token);
        setMaterials(current => current.map(m => m.id === item.id ? { ...m, token: uploaded.attachment.token, status: "Gati" } : m));
      }
      const pastedLinks = (input.match(/https?:\/\/[^\s<>"']+/g) ?? []).map(url => url.replace(/[.,;!?)}\]]+$/, ""));
      const reuse = !materials.length && !pastedLinks.length && previousMaterials.current?.context === materialContext ? previousMaterials.current : null;
      const materialTokens = reuse?.tokens ?? tokens;
      const materialLinks = [...new Set([...(pastedLinks.length ? [] : reuse?.links ?? []), ...materials.flatMap(item => item.url ? [item.url] : []), ...pastedLinks])];
      const data = await request({
        conversationId: conversation.id, revision: conversation.revision, requestId: sendAttempt.current.id,
        mode: "plan",
        attachments: materialTokens,
        links: materialLinks,
        text: input,
        history: pin ? workflowRequestHistory(pin.history) : lastContext.current === contextKey ? history.slice(-6) : [],
        context: effectiveContext,
        assistantName: appearance.name,
        ...(lastContext.current === contextKey && (result?.workflow?.proposed || result?.editableFlow || result?.linear) && result.token ? { pendingToken: result.token } : {}),
      });
      if (generation !== requestGeneration.current) return;
      previousMaterials.current = { context: materialContext, tokens: materialTokens, links: materialLinks };
      workflowRequest.current = effectiveContext.page === "workflows" && effectiveContext.workflowSelection && continuesWorkflowRequest(data) ? {
        scope: contextKey, context: effectiveContext,
        history: [...(pin?.history ?? []), { role: "user", content: input }, { role: "assistant", content: data.message || "Kontrollo propozimin." }],
      } : null;
      lastContext.current = contextKey;
      if (!data.persistence) setHistory((prev) => [
        ...prev.slice(-78),
        { role: "user", content: input, materials: [...materials.map(({name, preview, url, size}) => ({name, preview, url, size})), ...pastedLinks.filter(url => !materials.some(item => item.url === url)).map(url => ({name: url, url}))] },
        { role: "assistant", content: data.message || "Kontrollo propozimin." },
      ]);
      setResult(data);
      setRecovered(Boolean(data.recovered));
      sendAttempt.current = null;
      setText("");
      setMaterials([]);
      setMaterialError("");
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setResult(null);
      setError(e instanceof Error ? e.message : "Kërkesa nuk përfundoi.");
      setText((current) => (current.trim() ? current : input));
      if (archive.view) void archive.selectThread(archive.view.conversation);
    } finally {
      setOutgoing(null);
      locked.current = false;
      archive.inFlight.current = false;
      setSending(false);
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
    archive.inFlight.current = true;
    setBusy("confirm");
    setSending(true);
    setError("");
    try {
      const conversation = await archive.ensureConversation();
      const key = `confirm:${conversation.id}:${result.token}`;
      if (sendAttempt.current?.key !== key) sendAttempt.current = { key, id: crypto.randomUUID() };
      const data = await request({ mode: "confirm", token: result.token, conversationId: conversation.id, revision: conversation.revision, requestId: sendAttempt.current.id });
      sendAttempt.current = null;
      workflowRequest.current = null;
      setRequestContext(null);
      setResult(data);
      setWorkOpen(false);
      requestAnimationFrame(() => composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
      if (!data.persistence) setHistory((prev) => [
        ...prev,
        { role: "assistant", content: data.message || "Ndryshimi u ruajt." },
      ]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ruajtja nuk përfundoi.");
      setResult(previous => previous ? { ...previous, token: undefined } : null);
      if (archive.view) void archive.selectThread(archive.view.conversation);
    } finally {
      locked.current = false;
      archive.inFlight.current = false;
      setBusy(null);
      setSending(false);
    }
  }
  async function transcribe(file: File) {
    if (locked.current) return;
    locked.current = true;
    setBusy("audio");
    setSending(true);
    setError("");
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
      setSending(false);
    }
  }
  function reset() {
    if (locked.current) return;
    setWorkOpen(false);
    previousMaterials.current = null;
    setMaterials([]);
    setMaterialError("");
    requestGeneration.current++;
    workflowRequest.current = null;
    lastContext.current = "";
    setRequestContext(null);
    archive.newThread();
    setResult(null);
    setText("");
    setError("");
    setMode("text");
  }
  useEffect(() => {
    resetRef.current = reset;
    return () => { resetRef.current = null; };
  });
  return (
    <>
      {launcherTarget && createPortal(
        <PersonalAssistantWidget appearance={appearance} hidden={visible && !inline} busy={Boolean(busy)}
          awaitingApproval={Boolean(result?.preview && result.token && !result.saved)}
          onOpen={() => { onOpen(); if (inline) composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }} onSettings={() => setAppearanceOpen(true)} />,
        launcherTarget,
      )}
      <dialog
        ref={dialog}
        className={`business-assistant assistant-workspace-panel ${inline ? "assistant-inline-home" : ""} ${context.page === "home" ? "is-home" : ""} ${expanded ? "is-expanded" : ""} ${mode === "audio" ? "is-voice" : ""} ${result?.preview ? "has-work-detail" : ""} ${workOpen && result?.preview ? "is-work-open" : ""}`}
        style={
          {
            "--assistant-panel-width": `${panelWidth}px`,
            "--assistant-viewport-height": `${viewport.height || 800}px`,
            "--assistant-keyboard-bottom": `${viewport.bottom}px`,
            "--assistant-viewport-top": `${typeof window !== "undefined" ? window.visualViewport?.offsetTop ?? 0 : 0}px`,
          } as React.CSSProperties
        }
        aria-label={inline ? agentName : undefined}
        aria-labelledby={inline ? undefined : "business-assistant-title"}
        onCancel={(event) => {
          event.preventDefault();
          if (mobile && workOpen && result?.preview) { event.preventDefault(); returnToConversation(); }
          else if (!inline) onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !mobile && !inline && event.target instanceof Element && event.target.closest("dialog") === dialog.current) onClose();
        }}
      >
        <header className="assistant-heading" hidden={inline && mobile}>
          {!inline && <PersonalAssistantAvatar avatar={appearance.avatar} />}
          <div>
            <h2 id="business-assistant-title">{appearance.name} <span className="assistant-identity-role">— Asistenti yt</span></h2>
            <p>
              Për biznesin {businessName}
            </p>
          </div>
          <button type="button" className="personal-assistant-settings" onClick={() => { void archive.refreshThreads(); onHistoryOpen(); }} aria-label="Historiku i asistentit"><Icon name="history" size={17} /></button>
          {!inline && <button type="button" className="personal-assistant-settings" onClick={() => setAppearanceOpen(true)} aria-label="Personalizo asistentin"><Icon name="settings" size={17} /></button>}
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
          {!inline && <button
            type="button"
            className="assistant-close"
            onClick={onClose}
            aria-label="Mbyll bisedën"
          >
            ×
          </button>}
        </header>
        {!mobile && !inline && (
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
          <div className="assistant-context-status" aria-label="Konteksti i kërkesës" role="status">
            <span>{businessName} · {contextLabel(context)}{selectionLabel ? ` · ${selectionLabel}` : context.entityId ? ` · Elementi ${context.entityId.slice(0, 8)}` : ""}</span>
            {!!history.length && lastContext.current !== assistantContextKey(slug, context) && <p>Faqja ose zgjedhja ndryshoi. Migo përdor historikun e autorizuar të kësaj bisede dhe kontekstin e faqes; objektivi i një plani të hapur nuk ndryshon nga navigimi.</p>}
            {workflowRequest.current?.scope === assistantContextKey(slug, context) && <p>Kërkesa në vazhdim mbetet te rrjedha/nyja fillestare{requestLabel ? `: ${requestLabel}` : ""}. Për një zgjedhje tjetër, nis bisedë të re.</p>}
            {context.workflowSelection?.dirty && <p>Ka ndryshime të paruajtura në editor. Ruaji ose anuloji atje përpara se të aplikosh një ndryshim me {appearance.name}.</p>}
            {(result?.preview || result?.actionPlan) && requestContext && assistantContextKey(slug, requestContext) !== assistantContextKey(slug, context) && <p>Propozimi i hapur i përket: {contextLabel(requestContext)}{requestLabel ? ` · ${requestLabel}` : ""}. Navigimi nuk e ndryshon objektivin e tij.</p>}
          </div>
          {archive.loading && <p role="status">Po ngarkohet biseda…</p>}
          {archive.warning && <p role="alert">{archive.warning}</p>}
          {archive.view?.conversation.pending_request && !busy && <p role="status">Ka një kërkesë pa përgjigje të konfirmuar. Mund të jetë në përpunim ose e ndërprerë; asnjë veprim nuk përsëritet automatikisht.</p>}
          {recovered && <div className="assistant-recovery" role="status"><strong>Plan i rikthyer — jo autorizim për ekzekutim</strong><p>{archive.view?.recovery?.message || "Gatishmëria e mëparshme është historike. Rishqyrto përpara çdo veprimi."}</p>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setText(`Rishqyrto planin e ruajtur dhe përgatit propozim të ri, pa ekzekutuar ose publikuar: ${archive.view?.plan?.snapshot.request ?? ""}`); composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}>Rishqyrto me Migo</button></div>}
          {archive.view?.before && <button type="button" disabled={Boolean(busy)} onClick={() => void archive.olderMessages()}>Mesazhe më të vjetra</button>}
          {mode === "text" && !history.length && !result && (
            <div className="assistant-welcome">
              {inline && <p className="mobile-assistant-eyebrow">{appearance.name} — Asistenti yt</p>}
              <Greeting>{inline ? `Përshëndetje${userName?.trim() ? `, ${userName.trim().split(/\s+/)[0]}` : ""}.` : "Çfarë dëshiron të ndryshosh?"}{inline && <><br/><span>Çfarë bëjmë sot?</span></>}</Greeting>
              <p>
                {inline ? "Jam këtu për të të ndihmuar me biznesin. Pyet ose kërko një ndryshim." : "Menaxho produktet, shërbimet, njohuritë dhe takimet me një kërkesë."}
              </p>
              <div className="assistant-examples">
                {businessGoals(context, modules, external).map(
                  ({ text: example, label }) => (
                    <button
                      type="button"
                      key={example}
                      onClick={() => {
                        setText(example);
                        setMode("text");
                        composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
                      }}
                      disabled={Boolean(busy)}
                    >
                      <Icon name="spark" size={16} />
                      {inline ? label : example}
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
                {message.kind === "backend_outcome" && <small>Njoftim historik i backend-it · jo miratim për veprim të ri</small>}
                {message.kind === "interrupted" && <small>Rezultat i pakonfirmuar</small>}
                {message.materials?.length ? <div className="unified-attachments">{message.materials.map((item, index) => <FileCard key={index} item={item}/>)}</div> : null}
                {message.role === "user" && <small className="chat-receipt">seen</small>}
                {message.role === "assistant" && (
                  <div className="assistant-message-actions">
                    <MessageCopy text={message.content} />
                  </div>
                )}
              </div>
            ))}
            {outgoing && (
              <div className="assistant-message assistant-message-user">
                <p>{outgoing}</p>
                <small className="chat-receipt">Po dërgohet…</small>
              </div>
            )}
            {busy === "plan" && <div className="chat-typing" role="status" aria-label="Po shkruan"><i /><i /><i /></div>}
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
          {result?.productImport && <ProductCsvImport key={result.productImport.token} slug={slug} initialSource={result.productImport} />}
          {result?.actionPlan && <ActionPlanReview key={`${result.actionPlan.id}:${archive.restoration}`} plan={result.actionPlan} slug={slug} businessName={businessName} busy={Boolean(busy)}
            initialPreferences={archive.view?.plan?.preferences} onSavePreferences={archive.view?.plan ? archive.savePreferences : undefined}
            recoveryBlocked={recovered && !archive.view?.recovery?.verified} onAssessment={assessment => {
            const planId = result.actionPlan!.id;
            setResult(current => current?.actionPlan?.id === planId ? { ...current, actionPlan: refreshPlanCapability(current.actionPlan, assessment) } : current);
            router.refresh();
          }} onRequest={value => {
            setMode("text"); setText(value);
            requestAnimationFrame(() => composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
          }} />}
          {result?.workflow && <WorkflowCard key={JSON.stringify(result.workflow)} data={result.workflow} slug={slug} pending={Boolean(result.token)} onRequest={value => { setMode("text"); setText(value); }} />}
          {result?.linear && <LinearWorkflowCard data={result.linear} slug={slug} pending={Boolean(result.token)} onRequest={value=>{setMode("text");setText(value);}} />}
          {result?.preview && (
            <button ref={workTrigger} type="button" className="assistant-work-trigger"
              aria-controls="assistant-work-detail" aria-expanded={!mobile || workOpen}
              onClick={() => { setWorkOpen(true); if (!mobile) workBack.current?.focus(); }}>
              <span><strong>{result.preview.title}</strong><small>{recovered ? "Plan i rikthyer · kërkon rishqyrtim" : "Në pritje të konfirmimit"}</small></span>
              <span>Shiko ndryshimin →</span>
            </button>
          )}
          {result?.saved && (
            <div className="assistant-success" role="status">
              <Icon name="check" size={22} />
              <div>
                <strong>{result.message}</strong>
                {result.receipt && <PublicationReceiptView receipt={result.receipt} />}
                {result.warning && <p>{result.warning}</p>}
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
        <div ref={composerRegion} className="assistant-composer">
          {materialError && <p className="assistant-error" role="alert">{materialError}</p>}
          <div className="assistant-composer-top">
            {mode === "audio" ? <button type="button" className="assistant-write-instead" disabled={Boolean(busy)} onClick={() => setMode("text")}>
              <Icon name="edit" size={16} /> Shkruaj
            </button> : <small>Ndryshimet i konfirmon ti.</small>}
            <button type="button" className="assistant-reset assistant-reset-icon" onClick={reset} disabled={Boolean(busy)} aria-label="Bisedë e re" title="Bisedë e re">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          {mode === "text" ? (
            <AssistantComposer {...materialProps} id="business-assistant-input" label={`Shkruaji ${appearance.name}`} value={text} busy={Boolean(busy) || archive.loading} multiline
              onChange={(value) => { setText(value); if (result?.token && !result.workflow && !result.editableFlow && !result.linear) setResult(null); }}
              onSubmit={() => void analyze()} onVoice={() => { primeVoiceCapture(); setMode("audio"); }} />
          ) : (
            visible && <AudioRecorder variant="assistant" purpose="request" busy={Boolean(busy)} onAnalyze={transcribe} onBack={() => setMode("text")} analyzeLabel="Ktheje në tekst" />
          )}
        </div>
        {result?.preview && (
          <aside id="assistant-work-detail" className="assistant-work-detail" aria-label="Pamja e ndryshimit">
            <header className="assistant-work-heading">
              <button ref={workBack} type="button" onClick={() => {
                if (mobile) returnToConversation();
                else composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
              }}>← Biseda</button>
              <span>{recovered ? "Kërkon rishqyrtim të ri" : "Në pritje të konfirmimit"}</span>
            </header>
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
              {result.workflow?.semanticSummary && result.workflow.proposed ? <WorkflowChangeReview before={result.workflow.workspace.graph} after={result.workflow.proposed} summary={result.workflow.semanticSummary} simulation={result.workflow.simulation} /> : <dl>
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
              </dl>}
              {result.preview.notice && (
                <p className="assistant-notice">{result.preview.notice}</p>
              )}
              <p className="assistant-notice">
                {recovered ? "Ky është propozimi historik, jo leje për veprim. Rishqyrtoje me Migo për një konfirmim të ri." : "Asgjë nuk është ruajtur ende. Konfirmimi vlen për 10 minuta."}
              </p>
              <div className="assistant-preview-actions">
                {result.token && <button
                  type="button"
                  className="assistant-primary"
                  onClick={confirm}
                  disabled={Boolean(busy)}
                >
                  {busy === "confirm" ? "Po ruhet…" : result.workflow ? result.preview.title : "Konfirmo ndryshimin"}
                </button>}
                <button
                  type="button"
                  className="assistant-secondary"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (locked.current) return;
                    const generation = requestGeneration.current;
                    locked.current = true; archive.inFlight.current = true;
                    try {
                      if (archive.view?.plan) await archive.closePlan();
                      else setHistory(prev => [...prev, { role: "assistant", content: "Propozimi u anulua; asgjë nuk u ruajt." }]);
                    if (generation !== requestGeneration.current) return;
                    setWorkOpen(false);
                    requestAnimationFrame(() => composerRegion.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
                    workflowRequest.current = null;
                    setRequestContext(null);
                    setResult(null);
                    } catch (e) { setError((e as Error).message); }
                    finally { locked.current = false; archive.inFlight.current = false; }
                  }}
                >
                  Anulo
                </button>
              </div>
            </section>
          )}

            {error && <p className="assistant-error" role="alert">{error}</p>}
          </aside>
        )}
      </dialog>
      {appearanceOpen && <AssistantAppearanceDialog appearance={appearance} onSave={saveAppearance} onClose={() => setAppearanceOpen(false)} />}
      <AssistantHistory open={historyOpen} threads={archive.threads} busy={Boolean(busy) || archive.loading} warning={archive.warning} onClose={onHistoryClose}
        onSelect={thread => {
          if (locked.current) return;
          reset(); void archive.selectThread(thread);
          onHistoryClose(); onOpen();
        }} onNew={() => { reset(); onHistoryClose(); onOpen(); }}
        onRename={(thread, title) => void archive.rename(thread, title)} onDelete={thread => void archive.remove(thread)}
        onMore={archive.next ? () => void archive.moreThreads() : undefined} />
    </>
  );
}
