"use client";
import { useEffect, useState } from "react";
import type { SourcesState } from "@/lib/discovery/sources-step";
import "./sources-review.css";

/** "Gjetëm këto. Konfirmo?": what the agent learned from Instagram and the
 * website, published only after the owner confirms. */
export function SourcesReview({ slug, review, onDone }: { slug: string; review: NonNullable<SourcesState["review"]>; onDone: (published: number) => void }) {
  const [keep, setKeep] = useState<Set<string>>(() => new Set(review.knowledge.map((item) => item.id)));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = review.knowledge.map((item) => item.id).join();
  useEffect(() => { setKeep(new Set(ids ? ids.split(",") : [])); }, [ids]);

  async function send(action: "confirm" | "dismiss") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/business-sources?slug=${encodeURIComponent(slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "confirm" ? { action, keep: [...keep] } : { action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Konfirmimi nuk u ruajt.");
      onDone(result.kept ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : "Konfirmimi nuk u ruajt."); }
    finally { setBusy(false); }
  }

  const changes = [review.changesPanel && "menuja e panelit", review.changesAgent && "udhëzimet e Agjentit", review.changesProcess && "procesi i punës"].filter(Boolean) as string[];
  const changesText = changes.length > 1 ? `${changes.slice(0, -1).join(", ")} dhe ${changes.at(-1)}` : changes[0];
  return (
    <section className="sources-review" aria-labelledby="sources-review-title">
      <h2 id="sources-review-title">Gjetëm këto. Konfirmo?</h2>
      <p className="sources-review-lead">
        {review.knowledge.length
          ? "Zgjidh çfarë të përdorë Agjenti në përgjigje. Asgjë nuk publikohet pa konfirmimin tënd."
          : "Nuk u gjet informacion i ri për njohuritë."}
        {changesText ? ` Me konfirmimin përshtaten edhe ${changesText}.` : ""}
      </p>
      {review.knowledge.length > 0 && (
        <ul className="sources-review-list">
          {review.knowledge.map((item) => (
            <li key={item.id} className={keep.has(item.id) ? "is-kept" : ""}>
              <label>
                <input type="checkbox" checked={keep.has(item.id)} disabled={busy}
                  onChange={() => setKeep((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />
                <span className="sources-review-title">{item.title}</span>
              </label>
              <p className={open === item.id ? "is-open" : ""}>{item.body}</p>
              {item.body.length > 160 && (
                <button type="button" className="sources-review-more" onClick={() => setOpen(open === item.id ? null : item.id)}>
                  {open === item.id ? "Më pak" : "Shiko të plotë"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="sources-review-error" role="alert">{error}</p>}
      <div className="sources-review-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send("confirm")}>
          {busy ? "Duke ruajtur…" : review.knowledge.length && keep.size === review.knowledge.length ? "Konfirmo të gjitha" : review.knowledge.length ? `Konfirmo (${keep.size})` : "Konfirmo"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void send("dismiss")}>Mos i përdor</button>
      </div>
    </section>
  );
}
