"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryMessage } from "@/lib/business-assistant/history";
import type { ConversationView, StoredConversation, PlanningPreferences, StoredMessage } from "@/lib/business-assistant/persistence-model";
import type { FileCardItem } from "./file-card";
export { AssistantHistoryDrawer as AssistantHistory } from "./history-drawer";

export type ChatMessage = HistoryMessage & { materials?: FileCardItem[]; kind?: StoredMessage["kind"] };
type View = ConversationView & { recovery?: { verified: boolean; message: string } };
export function useAssistantHistory(userId: string, slug: string) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<StoredConversation[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [warning, setWarning] = useState("");
  const [restoration, setRestoration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const current = useRef<View | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  // Compatibility key from UX-3; selection only, not a canonical assistant identity.
  const selectedKey = `agjenti:migo-selected:v1:${userId}:${slug}`;
  const url = `/api/business-assistant/conversations?slug=${encodeURIComponent(slug)}`;
  const request = useCallback(async (suffix = "", body?: unknown) => {
    const g = generation.current;
    const r = await fetch(url + suffix, { cache: "no-store", signal: AbortSignal.timeout(20000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok) {
      if (g === generation.current && [401, 403, 404].includes(r.status)) {
        current.current = null; setView(null); setHistory([]); setRestoration(n => n + 1);
        if (r.status !== 404) setThreads([]);
        try { localStorage.removeItem(selectedKey); } catch {}
      }
      throw new Error(data.error || "Historiku nuk u ngarkua.");
    }
    return data;
  }, [url, selectedKey]);
  const accept = useCallback((data: View, restore = false) => {
    current.current = data; setView(data); setHistory(data.messages); setWarning("");
    try { localStorage.setItem(selectedKey, data.conversation.id); } catch { /* Selection only; private contents remain on server. */ }
    setThreads(items => [data.conversation, ...items.filter(t => t.id !== data.conversation.id)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    if (restore) setRestoration(n => n + 1);
  }, [selectedKey]);
  const load = useCallback(async (id: string) => {
    const g = ++generation.current;
    setLoading(true);
    current.current = null; setView(null); setHistory([]); setRestoration(n => n + 1);
    try {
      const data = await request(`&id=${encodeURIComponent(id)}&assess=1`);
      if (g === generation.current) accept(data, true);
    } catch (e) { if (g === generation.current) setWarning((e as Error).message); }
    finally { if (g === generation.current) setLoading(false); }
  }, [request, accept]);
  useEffect(() => {
    let alive = true;
    const fence = generation;
    const g = fence.current;
    request().then(async data => {
      if (!alive || g !== generation.current) return;
      setThreads(data.conversations); setNext(data.next);
      let id: string | null = null;
      try { id = localStorage.getItem(selectedKey); } catch {}
      if (id) await load(id);
      else setLoading(false);
    }).catch(e => { if (alive) { setWarning(e.message); setLoading(false); } });
    return () => { alive = false; fence.current++; };
  }, [request, load, selectedKey]);
  useEffect(() => {
    const sync = async () => {
      const active = current.current;
      if (!active || inFlight.current || document.visibilityState !== "visible") return;
      const g = generation.current;
      try {
        const data = await request(`&id=${active.conversation.id}&assess=1`);
        if (g === generation.current && !inFlight.current && data.conversation.revision !== current.current?.conversation.revision) accept(data, true);
      } catch (e) { if (g === generation.current) setWarning((e as Error).message); }
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const interval = window.setInterval(sync, 15000);
    return () => { clearInterval(interval); window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", sync); };
  }, [request, accept]);
  return { history, setHistory, threads, warning, view, loading, listLoading, restoration, next, inFlight, accept,
    async ensureConversation() {
      if (loading) throw new Error("Prit ngarkimin e historikut.");
      if (current.current) return current.current.conversation;
      const data = await request("", { mode: "create", id: crypto.randomUUID() });
      accept(data); return data.conversation as StoredConversation;
    },
    newThread() {
      generation.current++; current.current = null; setView(null); setHistory([]); setWarning(""); setLoading(false); setRestoration(n => n + 1);
      try { localStorage.removeItem(selectedKey); } catch {}
    },
    selectThread(thread: StoredConversation) { return load(thread.id); },
    async refreshThreads() {
      const g = generation.current;
      setListLoading(true);
      try { const data = await request(); if (g === generation.current) { setThreads(data.conversations); setNext(data.next); } }
      catch (e) { if (g === generation.current) setWarning((e as Error).message); }
      finally { setListLoading(false); }
    },
    async rename(thread: StoredConversation, title: string) {
      try {
        const data = await request("", { mode: "rename", id: thread.id, revision: thread.revision, title });
        setThreads(items => items.map(t => t.id === thread.id ? data.conversation : t));
        if (current.current?.conversation.id === thread.id) accept(data);
        return true;
      } catch (e) { setWarning((e as Error).message); return false; }
    },
    async remove(thread: StoredConversation) {
      try {
        await request("", { mode: "delete", id: thread.id, revision: thread.revision });
        setThreads(items => items.filter(t => t.id !== thread.id));
        if (current.current?.conversation.id === thread.id) {
          generation.current++; current.current = null; setView(null); setHistory([]); setRestoration(n => n + 1);
          try { localStorage.removeItem(selectedKey); } catch {}
        }
        return true;
      } catch (e) { setWarning((e as Error).message); return false; }
    },
    async olderMessages() {
      const active = current.current;
      if (!active?.before) return;
      try {
        const data = await request(`&id=${active.conversation.id}&before=${active.before}`);
        if (current.current?.conversation.id === active.conversation.id) accept({ ...current.current,
          messages: [...data.messages.filter((m: StoredMessage) => !current.current?.messages.some(existing => existing.seq === m.seq)), ...current.current.messages], before: data.before });
      } catch (e) { setWarning((e as Error).message); }
    },
    async moreThreads() {
      if (!next || listLoading) return;
      const g = generation.current;
      setListLoading(true);
      try { const data = await request(`&cursor=${encodeURIComponent(next)}`); if (g === generation.current) { setThreads(items => [...items, ...data.conversations.filter((t: StoredConversation) => !items.some(i => i.id === t.id))]); setNext(data.next); } }
      catch (e) { if (g === generation.current) setWarning((e as Error).message); }
      finally { setListLoading(false); }
    },
    async savePreferences(preferences: PlanningPreferences) {
      const active = current.current;
      const g = generation.current;
      if (!active?.plan) throw new Error("Plani nuk është ruajtur.");
      try {
        const data = await request("", { mode: "preferences", id: active.conversation.id, revision: active.plan.revision, preferences });
        if (g === generation.current && current.current?.conversation.id === active.conversation.id)
          accept({ ...data, recovery: active.recovery });
      } catch (e) { if (g === generation.current) setWarning((e as Error).message); throw e; }
    },
    async closePlan() {
      const active = current.current, g = generation.current;
      if (!active?.plan) return;
      const data = await request("", { mode: "close_plan", id: active.conversation.id, revision: active.plan.revision });
      if (g === generation.current && current.current?.conversation.id === active.conversation.id) accept(data, true);
    },
  };
}
