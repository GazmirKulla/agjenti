"use client";
import { useEffect, useState } from "react";
import type { SourcesState } from "@/lib/discovery/sources-step";
import "./sources-review.css";

type Draft = { title: string; body: string };

/** "Gjetëm këto. Konfirmo?": what the agent learned from Instagram and the
 * website; each entry is accepted, rejected or edited before it is published.
 * immediate (Knowledge page): Prano puts one entry in use at once and Refuzo removes it, without a batch confirm. */
export function SourcesReview({ slug, review, onDone, immediate = false, onChanged }: {
  slug: string; review: NonNullable<SourcesState["review"]>; onDone: (published: number) => void;
  immediate?: boolean; onChanged?: (message: string) => void;
}) {
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = review.knowledge.map((item) => item.id).join();
  useEffect(() => { setRejected(new Set()); setEdits({}); setEditing(null); }, [ids]);
  const kept = review.knowledge.filter((item) => !rejected.has(item.id));

  async function send(action: "confirm" | "dismiss") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/business-sources?slug=${encodeURIComponent(slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "confirm"
          ? { action, keep: kept.map((item) => item.id), edits: Object.entries(edits).filter(([id]) => !rejected.has(id)).map(([id, draft]) => ({ id, ...draft })) }
          : { action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Konfirmimi nuk u ruajt.");
      onDone(result.kept ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : "Konfirmimi nuk u ruajt."); }
    finally { setBusy(false); }
  }
  async function decide(id: string, decision: "accept" | "reject", edit?: Draft) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/business-sources?slug=${encodeURIComponent(slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", id, decision, ...(edit ? { edit } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Vendimi nuk u ruajt.");
      setEditing(null);
      onChanged?.(decision === "accept" ? "Njohuria u pranua dhe Agjenti e përdor tani." : "Propozimi u refuzua dhe u hoq.");
    } catch (e) { setError(e instanceof Error ? e.message : "Vendimi nuk u ruajt."); }
    finally { setBusy(false); }
  }
  function toggle(id: string) {
    setRejected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    if (editing === id) setEditing(null);
  }

  const changes = [review.changesPanel && "menuja e panelit", review.changesAgent && "udhëzimet e Agjentit", review.changesProcess && "procesi i punës"].filter(Boolean) as string[];
  const changesText = changes.length > 1 ? `${changes.slice(0, -1).join(", ")} dhe ${changes.at(-1)}` : changes[0];
  if (immediate) return (
    <section className="sources-review" aria-labelledby="sources-review-title">
      <h2 id="sources-review-title">Propozime nga burimet</h2>
      <p className="sources-review-lead">
        {review.knowledge.length
          ? "Prano e vë njohurinë në përdorim menjëherë; Refuzo e heq. Agjenti nuk përdor asgjë pa pranimin tënd."
          : changesText ? `Burimet propozojnë edhe ndryshime për ${changesText}.` : "Nuk ka më propozime."}
      </p>
      {review.knowledge.length > 0 && (
        <ul className="sources-review-list">
          {review.knowledge.map((item) => {
            const shown = edits[item.id] ?? { title: item.title, body: item.body };
            return (
              <li key={item.id} className="is-kept">
                {editing === item.id ? (
                  <div className="sources-review-edit">
                    <label>Titulli<input className="field" value={shown.title} maxLength={500} onChange={(e) => setEdits({ ...edits, [item.id]: { ...shown, title: e.target.value } })} /></label>
                    <label>Teksti<textarea className="field" rows={5} value={shown.body} maxLength={8000} onChange={(e) => setEdits({ ...edits, [item.id]: { ...shown, body: e.target.value } })} /></label>
                    <div className="sources-review-row-actions">
                      <button type="button" className="btn btn-primary" disabled={busy || shown.title.trim().length < 2 || shown.body.trim().length < 2} onClick={() => void decide(item.id, "accept", shown)}>Ruaj dhe prano</button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { const next = { ...edits }; delete next[item.id]; setEdits(next); setEditing(null); }}>Anulo</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sources-review-row-head"><span className="sources-review-title">{shown.title}</span></div>
                    <p>{shown.body}</p>
                    <div className="sources-review-row-actions">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide(item.id, "accept")}>Prano</button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(item.id)}>Ndrysho</button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void decide(item.id, "reject")}>Refuzo</button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!review.knowledge.length && changesText && <div className="sources-review-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send("confirm")}>Prano</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void send("dismiss")}>Refuzo</button>
      </div>}
      {error && <p className="sources-review-error" role="alert">{error}</p>}
    </section>
  );
  return (
    <section className="sources-review" aria-labelledby="sources-review-title">
      <h2 id="sources-review-title">Gjetëm këto. Konfirmo?</h2>
      <p className="sources-review-lead">
        {review.knowledge.length
          ? "Prano, refuzo ose ndrysho çdo njohuri. Vetëm ato që pranon i përdor Agjenti në përgjigje."
          : "Nuk u gjet informacion i ri për njohuritë."}
        {changesText ? ` Me konfirmimin përshtaten edhe ${changesText}.` : ""}
      </p>
      {review.knowledge.length > 0 && (
        <ul className="sources-review-list">
          {review.knowledge.map((item) => {
            const off = rejected.has(item.id);
            const shown = edits[item.id] ?? { title: item.title, body: item.body };
            return (
              <li key={item.id} className={off ? "is-rejected" : "is-kept"}>
                {editing === item.id ? (
                  <div className="sources-review-edit">
                    <label>Titulli<input className="field" value={shown.title} maxLength={500} onChange={(e) => setEdits({ ...edits, [item.id]: { ...shown, title: e.target.value } })} /></label>
                    <label>Teksti<textarea className="field" rows={5} value={shown.body} maxLength={8000} onChange={(e) => setEdits({ ...edits, [item.id]: { ...shown, body: e.target.value } })} /></label>
                    <div className="sources-review-row-actions">
                      <button type="button" className="btn btn-primary" disabled={shown.title.trim().length < 2 || shown.body.trim().length < 2} onClick={() => setEditing(null)}>Ruaj ndryshimin</button>
                      <button type="button" className="btn btn-ghost" onClick={() => { const next = { ...edits }; delete next[item.id]; setEdits(next); setEditing(null); }}>Anulo</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sources-review-row-head">
                      <span className="sources-review-title">{shown.title}{edits[item.id] ? <small> · ndryshuar</small> : null}</span>
                      <span className={`sources-review-state ${off ? "is-off" : "is-on"}`}>{off ? "Refuzuar" : "Pranuar"}</span>
                    </div>
                    <p>{shown.body}</p>
                    <div className="sources-review-row-actions">
                      <button type="button" className="sources-review-more" disabled={busy} onClick={() => toggle(item.id)}>{off ? "Prano" : "Refuzo"}</button>
                      {!off && <button type="button" className="sources-review-more" disabled={busy} onClick={() => setEditing(item.id)}>Ndrysho</button>}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="sources-review-error" role="alert">{error}</p>}
      <div className="sources-review-actions">
        <button type="button" className="btn btn-primary" disabled={busy || editing !== null} onClick={() => void send("confirm")}>
          {busy ? "Duke ruajtur…" : review.knowledge.length ? `Konfirmo (${kept.length} nga ${review.knowledge.length})` : "Konfirmo"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void send("dismiss")}>Mos përdor asnjë</button>
      </div>
    </section>
  );
}
