"use client";
import { useEffect, useRef, useState } from "react";
export type ReplyOperation = { requestId: string; body: string; status: string; error?: string; accepted?: boolean; canRetry?: boolean; attempts?: number };
/** Transport UI only: persisted IDs are reconciled with the authoritative outbox. */
export function useReplyOutbox(url: string, storageKey: string, onRefresh: () => void) {
  const [operations, setOperations] = useState<ReplyOperation[]>([]);
  const [error, setError] = useState("");
  const current = useRef<ReplyOperation[]>([]);
  const refresh = useRef(onRefresh);
  const retrying = useRef(new Set<string>());
  refresh.current = onRefresh;
  useEffect(() => {
    let disposed = false, running = false;
    const save = (next: ReplyOperation[]) => {
      if (disposed) return;
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      current.current = next; setOperations(next);
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
      save(Array.isArray(saved) ? saved.filter(o => typeof o.requestId === "string" && typeof o.body === "string" && typeof o.status === "string").slice(-100) : []);
    } catch { current.current = []; setOperations([]); setError("Ruajtja lokale nuk është e disponueshme."); }
    async function sync() {
      if (disposed || running) return;
      running = true;
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Statusi nuk u ngarkua.");
        if (disposed) return;
        const jobs = body.jobs as ReplyOperation[];
        if (!Array.isArray(jobs)) throw new Error("Status i pavlefshëm.");
        const merged = current.current.map(local => {
          const job = jobs.find(j => j.requestId === local.requestId);
          return job ? { ...local, ...job, accepted: true } : local;
        });
        for (const job of jobs) if (!merged.some(o => o.requestId === job.requestId)) merged.push({ ...job, accepted: true });
        // Never evict an unaccepted operation when server history is merged.
        save([...merged.filter(o => !o.accepted), ...merged.filter(o => o.accepted).slice(-100)]);
        const next = current.current.find(o => !o.accepted);
        if (next?.status === "queued") {
          const sent = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ requestId: next.requestId, body: next.body }) });
          const result = await sent.json();
          if (disposed) return;
          save(current.current.map(o => o.requestId === next.requestId ? { ...o, accepted: sent.ok, status: sent.ok ? result.status : "failed", error: result.error } : o));
        }
        setError("");
        refresh.current();
      } catch { if (!disposed) setError("Lidhja nuk u konfirmua. Kërkesa ruhet me të njëjtin identitet; po kontrollojmë statusin."); }
      finally { running = false; }
    }
    void sync();
    const interval = setInterval(() => void sync(), 2000);
    window.addEventListener("online", sync);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener("online", sync); };
  }, [url, storageKey]);
  const save = (next: ReplyOperation[]) => {
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    current.current = next; setOperations(next);
  };
  function enqueue(body: string) {
    try {
      if (current.current.filter(o => !["sent", "failed"].includes(o.status)).length >= 40) throw new Error("Radha është plot; prit përfundimin e mesazheve.");
      save([...current.current, { requestId: crypto.randomUUID(), body, status: "queued" }]);
      setError(""); return true;
    } catch { setError("Mesazhi nuk u vu në radhë. Kontrollo ruajtjen e shfletuesit dhe kapacitetin e radhës."); return false; }
  }
  async function retry(requestId: string) {
    const operation = current.current.find(o => o.requestId === requestId);
    if (operation?.accepted && operation.canRetry && !retrying.current.has(requestId)) {
      retrying.current.add(requestId);
      try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ requestId, body: operation.body, retryAttempt: operation.attempts }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setError(""); refresh.current();
      } catch { setError("Retry nuk u konfirmua. Po kontrollojmë të njëjtin operacion; nuk krijohet mesazh i ri."); }
      finally { retrying.current.delete(requestId); }
      return;
    }
    // Only an unaccepted enqueue can be safely retried here. An uncertain
    // provider send requires reconciliation, not a second provider request.
    save(current.current.map(o => o.requestId === requestId && !o.accepted ? { ...o, status: "queued", error: undefined } : o));
  }
  return { operations, enqueue, retry, error };
}
