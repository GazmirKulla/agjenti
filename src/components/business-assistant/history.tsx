"use client";
import { useEffect, useRef, useState } from "react";
import { historyStorageKey, readHistory, saveThread, type AssistantThread, type HistoryMessage } from "@/lib/business-assistant/history";
import type { FileCardItem } from "./file-card";

export type ChatMessage = HistoryMessage & { materials?: FileCardItem[] };
export function useAssistantHistory(userId: string, slug: string) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState("");
  const active = useRef<string | null>(null);
  const key = historyStorageKey(userId, slug);
  useEffect(() => {
    try { setThreads(readHistory(localStorage.getItem(key))); }
    catch { setWarning("Historiku nuk mund të ruhet në këtë pajisje."); }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready || !history.length) return;
    active.current ??= crypto.randomUUID();
    setThreads(previous => saveThread(previous, active.current!, history, new Date().toISOString()));
  }, [history, ready]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify(threads)); }
    catch { setWarning("Historiku nuk u ruajt në pajisje. Biseda aktuale mbetet e hapur."); }
  }, [threads, key, ready]);
  return { history, setHistory, threads, warning,
    newThread() { active.current = null; setHistory([]); },
    selectThread(thread: AssistantThread) { active.current = thread.id; setHistory(thread.messages); },
    clearHistory() { setThreads([]); active.current = null; setHistory([]); },
  };
}

export function AssistantHistory({ open, threads, busy, warning, onClose, onSelect, onClear }: {
  open: boolean; threads: AssistantThread[]; busy: boolean; warning: string;
  onClose: () => void; onSelect: (thread: AssistantThread) => void; onClear: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open) ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="assistant-history" aria-labelledby="assistant-history-title" onCancel={onClose}>
    <header><div><h2 id="assistant-history-title">Bisedat me asistentin</h2><p>Ruajtur në këtë pajisje · për këtë biznes</p></div><button type="button" onClick={onClose} aria-label="Mbyll historikun">×</button></header>
    {warning && <p role="alert">{warning}</p>}
    <div className="assistant-history-list">{threads.length ? threads.map(thread => <button type="button" key={thread.id} disabled={busy} onClick={() => onSelect(thread)}><strong>{thread.title}</strong><small>{new Date(thread.updatedAt).toLocaleDateString("sq-AL")} · {thread.messages.length} mesazhe</small></button>) : <p>Bisedat që zhvillon do të shfaqen këtu.</p>}</div>
    {threads.length > 0 && <button type="button" className="assistant-history-clear" disabled={busy} onClick={() => { if (window.confirm("Pastro historikun e asistentit për këtë biznes në këtë pajisje?")) onClear(); }}>Pastro historikun në pajisje</button>}
  </dialog>;
}
