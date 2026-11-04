"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AttentionSnapshot } from "@/lib/business-assistant/attention-model";
import "./attention.css";

export function AssistantAttention({ slug, active, onResume }: {
  slug: string; active: boolean; onResume: (conversationId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let pending = false;
    const controller = new AbortController();
    async function read() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetch(`/api/business-assistant/attention?slug=${encodeURIComponent(slug)}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw Error("unavailable");
        const data: AttentionSnapshot = await response.json();
        if (alive) { setSnapshot(data); setError(false); }
      } catch { if (alive) { setError(true); setSnapshot(null); } }
      finally { pending = false; }
    }
    void read();
    const interval = window.setInterval(() => void read(), 60000);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => { alive = false; controller.abort(); clearInterval(interval);
      document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); };
  }, [slug, active, refresh]);
  if (!active) return null;
  return <section className="assistant-attention" aria-label="Punët për ndjekje">
    <header><h2>Për t’u ndjekur</h2><button type="button" onClick={() => setRefresh(value => value + 1)}>Rifresko</button></header>
    {error ? <p role="status">Nuk u kontrolluan punët. Provo përsëri.</p> : !snapshot ? <p>Po kontrolloj punët e pambaruara…</p> : <>
      {snapshot.items.length === 0 && snapshot.unavailable.length === 0 && <p>Nuk u gjetën punë të hapura në burimet e kontrolluara.</p>}
      <ul>{snapshot.items.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.detail}</p>
        {item.conversationId ? <button type="button" onClick={() => onResume(item.conversationId!)}>{item.action} →</button>
          : <Link href={item.href}>{item.action} →</Link>}</li>)}</ul>
      {snapshot.unavailable.length > 0 && <p role="status">Kontroll i pjesshëm: nuk u lexuan {snapshot.unavailable.join(", ")}.</p>}
      <small>Kontroll automatik gjatë përdorimit. Propozimet kërkojnë konfirmimin tënd.</small>
    </>}
  </section>;
}
