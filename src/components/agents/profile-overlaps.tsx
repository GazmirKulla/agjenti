"use client";
import Link from "next/link";
import { useState } from "react";
import { checkProfileOverlaps, switchOffRepeatingKnowledge } from "@/lib/business-profile/actions";
import type { ProfileOverlap } from "@/lib/business-profile/overlap";

/**
 * Knowledge written before the profile may repeat its contacts, address or hours: two sources for one fact.
 * On request, the matches are shown and the owner decides each one; nothing is switched off on its own.
 */
export function ProfileOverlaps({ slug }: { slug: string }) {
  const [state, setState] = useState<{ status: "idle" | "checking" | "done"; overlaps: ProfileOverlap[]; error?: string; notice?: string }>({ status: "idle", overlaps: [] });
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  async function check() {
    setState({ status: "checking", overlaps: [] }); setKept(new Set());
    const result = await checkProfileOverlaps(slug);
    setState("error" in result ? { status: "idle", overlaps: [], error: result.error } : { status: "done", overlaps: result.overlaps ?? [] });
  }
  async function switchOff(overlap: ProfileOverlap) {
    setBusy(overlap.id);
    const result = await switchOffRepeatingKnowledge(slug, overlap.id, overlap.updatedAt);
    setBusy("");
    setState(current => "error" in result && result.error ? { ...current, error: result.error, notice: undefined }
      : { ...current, error: undefined, notice: result.success, overlaps: current.overlaps.filter(item => item.id !== overlap.id) });
  }
  const open = state.overlaps.filter(item => !kept.has(item.id));
  return <section className="panel section-pad profile-overlaps" aria-labelledby="profile-overlaps-title">
    <h2 id="profile-overlaps-title">Njohuri që mund të përsërisin profilin</h2>
    <p className="muted-copy">Njohuritë e shkruara më parë mund të kenë kontakte, adresë ose orar. Kontrolli i gjen sipas kuptimit; ti vendos për secilën që një fakt të ketë një burim.</p>
    <button type="button" className="btn btn-ghost" disabled={state.status === "checking"} onClick={() => void check()}>{state.status === "checking" ? "Duke kontrolluar…" : "Kontrollo njohuritë"}</button>
    {state.error && <p role="alert" className="form-feedback form-feedback-error">{state.error}</p>}
    {state.notice && <p role="status" className="form-feedback form-feedback-success">{state.notice}</p>}
    {state.status === "done" && !open.length && !state.error && <p className="muted-copy" role="status">Nuk u gjet njohuri që përsërit kontaktet, adresën ose orarin.</p>}
    {open.length > 0 && <ul className="offer-summary-list">{open.map(overlap => <li key={overlap.id}>
      <div><b>{overlap.title}</b><small>{overlap.excerpt}{overlap.excerpt.length >= 240 ? "…" : ""}</small></div>
      <div className="profile-overlap-actions">
        <button type="button" className="btn btn-ghost" disabled={busy === overlap.id} onClick={() => void switchOff(overlap)}>Mbaj profilin, fike njohurinë</button>
        <button type="button" className="btn btn-ghost" disabled={busy === overlap.id} onClick={() => setKept(current => new Set(current).add(overlap.id))}>Mbaje</button>
        <Link className="inline-link" href={`/b/${slug}/knowledge?entry=${overlap.id}&nga=agents/business`}>Hape</Link>
      </div>
    </li>)}</ul>}
  </section>;
}
