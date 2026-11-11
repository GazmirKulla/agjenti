"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { SourcesReview } from "@/components/dashboard/sources-review";
import { DiscoveryScanDialog } from "@/components/setup/scan-dialog";
import type { SourcesPreview, SourcesState } from "@/lib/discovery/sources-step";

type Stage = "form" | "reading" | "confirm" | "learning" | "review";
type Decision = "yes" | "no" | null;
type Row = { source: "instagram" | "website"; label: string; progress: number; step: string; state: "waiting" | "running" | "done" | "failed" };

const sourceLabel = { instagram: "Instagram", website: "Website" } as const;

/** One line per source with its own bar, so the owner sees what is happening. */
function ProgressRows({ rows }: { rows: Row[] }) {
  const total = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length) : 0;
  return (
    <div className="sources-progress" role="status" aria-live="polite">
      <div className="sources-progress-total">
        <span>{total < 100 ? "Duke punuar…" : "Gati"}</span>
        <strong>{total}%</strong>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.source} className={`is-${row.state}`}>
            <span className={`sources-progress-icon${row.source === "instagram" ? " is-instagram" : ""}`}>
              <Icon name={row.source === "instagram" ? "instagram" : "display"} size={18} />
            </span>
            <div className="sources-progress-body">
              <div className="sources-progress-line">
                <strong>{row.label}</strong>
                <span>{row.state === "done" ? "✓ " : ""}{row.step}</span>
              </div>
              <div className="sources-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(row.state === "running" ? 8 : 0, row.progress)}%` }} className={row.state === "running" ? "is-running" : undefined} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const count = (value?: number) => typeof value === "number" ? value.toLocaleString("sq-AL") : null;

/** Onboarding step 2: where the agent learns from.
 *  1. The owner gives the Instagram username and the website; both are read at once.
 *  2. Each one is shown (photo, name, numbers / logo, name) and the owner confirms it is theirs.
 *  3. The confirmed Instagram (last posts) and then the website (home, about, contact) are scanned.
 *  4. Everything found is merged by the AI; the owner accepts, rejects or edits each entry.
 *  Then step 3, the channel. */
export function SourcesStep({ slug }: { slug: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const next = `/onboarding/channel?slug=${encodeURIComponent(slug)}`;
  const [stage, setStage] = useState<Stage>("form");
  const [username, setUsername] = useState("");
  const [website, setWebsite] = useState("");
  const [preview, setPreview] = useState<SourcesPreview | null>(null);
  const [reading, setReading] = useState<Row[]>([]);
  const [decision, setDecision] = useState<{ instagram: Decision; website: Decision }>({ instagram: null, website: null });
  const [state, setState] = useState<SourcesState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Veprimi nuk u krye. Provo përsëri.");
    return result;
  }, [endpoint]);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) setState(await response.json());
  }, [endpoint]);

  const running = state?.scans.some((scan) => ["queued", "running"].includes(scan.status)) ?? true;
  useEffect(() => {
    if (stage !== "learning" || (state && !running)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [stage, state, running, load]);
  // When the scans end with a proposal, the review takes over.
  useEffect(() => {
    if (stage === "learning" && state && !running && state.review && !dialogOpen) setStage("review");
  }, [stage, state, running, dialogOpen]);

  async function look() {
    setBusy(true); setError("");
    const order = ([website.trim() && "website", username.trim() && "instagram"].filter(Boolean)) as Row["source"][];
    setReading(order.map((source, index) => ({ source, label: sourceLabel[source], progress: 0, state: index ? "waiting" : "running",
      step: index ? "Në radhë" : source === "website" ? "Po hapet faqja" : "Po lexohet profili" })));
    setStage("reading");
    const update = (source: Row["source"], change: Partial<Row>) => setReading((current) => current.map((row) => row.source === source ? { ...row, ...change } : row));
    const found: SourcesPreview = { instagram: null, website: null, about: null };
    try {
      for (const source of order) {
        update(source, { state: "running", progress: 35, step: source === "website" ? "Po hapet faqja" : "Po lexohet profili" });
        const result = await post({ action: "preview", username, website, only: source }) as SourcesPreview;
        found[source] = result[source] as never;
        const failed = !!result[source] && "error" in result[source]!;
        update(source, { state: failed ? "failed" : "done", progress: 100, step: failed ? "Nuk u lexua" : "U lexua" });
      }
      setPreview(found);
      setDecision({ instagram: found.instagram && !("error" in found.instagram) ? null : "no", website: found.website && !("error" in found.website) ? null : "no" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStage("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nuk u lexua.");
      setStage("form");
    } finally { setBusy(false); }
  }

  async function decide(source: "instagram" | "website", value: Decision) {
    const nextDecision = { ...decision, [source]: value };
    setDecision(nextDecision);
    if (nextDecision.instagram === null || nextDecision.website === null) return;
    if (nextDecision.instagram !== "yes" && nextDecision.website !== "yes") return;
    // Both answered and at least one is theirs: the scan starts.
    setBusy(true); setError("");
    try {
      await post({ action: "learn", confirmed: { instagram: nextDecision.instagram === "yes", website: nextDecision.website === "yes" } });
      setStage("learning"); setDialogOpen(true); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Analiza nuk nisi."); }
    finally { setBusy(false); }
  }

  const ig = preview?.instagram;
  const site = preview?.website;
  const igOk = ig && !("error" in ig) ? ig : null;
  const siteOk = site && !("error" in site) ? site : null;
  const nothingConfirmed = decision.instagram === "no" && decision.website === "no";
  const title = stage === "form" ? "Ku e gjejnë klientët biznesin tënd?" : stage === "reading" ? "Po lexojmë profilin tënd"
    : stage === "confirm" ? "A janë këto llogaritë e tua?" : stage === "review" ? "Agjenti mbaroi së mësuari" : "Agjenti po mëson";
  const lead = stage === "form" ? "Shkruaj Instagram-in dhe website-in. Agjenti lexon vetëm atë që është publike; nuk kërkohet lidhja e llogarisë."
    : stage === "reading" ? "Zakonisht zgjat 10–20 sekonda."
    : stage === "confirm" ? "Kontrollo foton, emrin dhe numrat. Analiza fillon vetëm për llogaritë që konfirmon."
    : stage === "review" ? "Prano, refuzo ose ndrysho atë që gjeti. Vetëm ato që pranon i përdor Agjenti."
    : "Po lexohen postimet e Instagram-it dhe faqet e website-it. Zakonisht 1–2 minuta.";

  return (
    <>
      <div className="onboarding-progress">
        <progress max={3} value={2} aria-label="Progresi i konfigurimit" />
        <span>Hapi 2 nga 3</span>
      </div>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">NGA KU TË MËSOJË AGJENTI</span>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>

      {stage === "form" && (
        <form className="onboarding-sources-step" onSubmit={(e) => { e.preventDefault(); void look(); }}>
          <fieldset className="onboarding-sources" disabled={busy}>
            <label htmlFor="sources-instagram">Instagram i biznesit</label>
            <input id="sources-instagram" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@dyqani.im"
              maxLength={80} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <label htmlFor="sources-website">Website</label>
            <input id="sources-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="zana.al" inputMode="url"
              maxLength={2000} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <small className="onboarding-hint">Lidhja e Instagram-it për t&apos;u përgjigjur klientëve bëhet në hapin tjetër.</small>
          </fieldset>
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <a className="onboarding-back" href={next}>Anashkalo</a>
            <div className="onboarding-actions-end">
              <button className="onboarding-next" type="submit" disabled={busy || (!username.trim() && !website.trim())}>{busy ? "Duke lexuar…" : "Vazhdo"}</button>
            </div>
          </div>
        </form>
      )}

      {stage === "reading" && <div className="onboarding-found"><ProgressRows rows={reading} /></div>}

      {stage === "confirm" && preview && (
        <div className="onboarding-found">
          {ig && (
            <article className={`onboarding-confirm-card is-${decision.instagram ?? "open"}`}>
              <div className="onboarding-confirm-identity">
                {igOk?.picture ? <Image className="onboarding-confirm-photo" src={igOk.picture} alt="" referrerPolicy="no-referrer" width={64} height={64} unoptimized />
                  : <span className="onboarding-found-icon is-instagram"><Icon name="instagram" size={24} /></span>}
                <div>
                  <h2>{igOk?.name || `@${ig.username}`}</h2>
                  <p className="onboarding-found-meta">@{ig.username} · Instagram</p>
                  {igOk && (count(igOk.followers) || count(igOk.posts)) && (
                    <p className="onboarding-confirm-stats">
                      {count(igOk.followers) && <span><strong>{count(igOk.followers)}</strong> ndjekës</span>}
                      {count(igOk.posts) && <span><strong>{count(igOk.posts)}</strong> postime</span>}
                    </p>
                  )}
                </div>
              </div>
              {igOk?.biography && <p className="onboarding-confirm-bio">{igOk.biography}</p>}
              {"error" in ig ? <p className="onboarding-found-error">{ig.error}</p> : (
                <ConfirmButtons decision={decision.instagram} busy={busy} yes="Po, është imja" onYes={() => void decide("instagram", "yes")} onNo={() => void decide("instagram", "no")} />
              )}
            </article>
          )}
          {site && (
            <article className={`onboarding-confirm-card is-${decision.website ?? "open"}`}>
              <div className="onboarding-confirm-identity">
                {siteOk?.logo ? <Image className="onboarding-confirm-logo" src={siteOk.logo} alt="" referrerPolicy="no-referrer" width={64} height={64} unoptimized />
                  : <span className="onboarding-found-icon"><Icon name="display" size={24} /></span>}
                <div>
                  <h2>{siteOk?.title || site.url}</h2>
                  <p className="onboarding-found-meta">{site.url}</p>
                </div>
              </div>
              {siteOk?.description && <p className="onboarding-confirm-bio">{siteOk.description}</p>}
              {"error" in site ? <p className="onboarding-found-error">{site.error}</p> : (
                <ConfirmButtons decision={decision.website} busy={busy} yes="Po, është imi" onYes={() => void decide("website", "yes")} onNo={() => void decide("website", "no")} />
              )}
            </article>
          )}
          {busy && <p className="onboarding-hint" role="status">Po nis analiza…</p>}
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <button type="button" className="onboarding-back" disabled={busy} onClick={() => { setStage("form"); setError(""); }}>Ndrysho të dhënat</button>
            <div className="onboarding-actions-end">
              {nothingConfirmed && <a className="onboarding-next" href={next}>Vazhdo pa analizë</a>}
            </div>
          </div>
        </div>
      )}

      {(stage === "learning" || stage === "review") && (
        <div className="onboarding-found">
          {stage === "review" && state?.review ? (
            <SourcesReview slug={slug} review={state.review} onDone={() => window.location.assign(next)} />
          ) : state?.scans.length ? (
            <>
              <ProgressRows rows={state.scans.map((scan) => ({ source: scan.source, label: sourceLabel[scan.source], progress: scan.progress, step: scan.step,
                state: scan.status === "completed" ? "done" : scan.status === "failed" ? "failed" : scan.id.endsWith("waiting") || (scan.status === "queued" && scan.progress <= 5) ? "waiting" : "running" }))} />
              <button type="button" className="onboarding-skip" onClick={() => setDialogOpen(true)}>Shiko skanimin</button>
              {!running && !state.review && <p className="onboarding-hint">Analiza mbaroi pa gjetur informacion të ri.</p>}
            </>
          ) : <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Po nis analiza…</div>}
          <div className="onboarding-actions">
            <span />
            <div className="onboarding-actions-end">
              <a className={stage === "review" ? "onboarding-skip" : "onboarding-next"} href={next}>{stage === "review" ? "Konfirmo më vonë" : running ? "Vazhdo ndërkohë" : "Vazhdo"}</a>
            </div>
          </div>
          <DiscoveryScanDialog open={dialogOpen && stage === "learning"} jobs={state?.scans ?? []} startingSource="" error=""
            onClose={() => setDialogOpen(false)} onReview={() => { setDialogOpen(false); if (state?.review) setStage("review"); }} />
        </div>
      )}
    </>
  );
}

function ConfirmButtons({ decision, busy, yes, onYes, onNo }: { decision: Decision; busy: boolean; yes: string; onYes: () => void; onNo: () => void }) {
  if (decision === "yes") return <p className="onboarding-confirm-done">✓ Konfirmuar <button type="button" className="onboarding-skip" disabled={busy} onClick={onNo}>Nuk është imja</button></p>;
  if (decision === "no") return <p className="onboarding-confirm-done is-no">Nuk do të përdoret <button type="button" className="onboarding-skip" disabled={busy} onClick={onYes}>Është imja</button></p>;
  return (
    <div className="onboarding-confirm-actions">
      <button type="button" className="onboarding-next" disabled={busy} onClick={onYes}>{yes}</button>
      <button type="button" className="onboarding-back" disabled={busy} onClick={onNo}>Jo, nuk është</button>
    </div>
  );
}
