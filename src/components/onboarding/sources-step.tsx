"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { SourcesReview } from "@/components/dashboard/sources-review";
import type { SourcesPreview, SourcesState } from "@/lib/discovery/sources-step";

type Stage = "form" | "reading" | "preview" | "learning";
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

/** Onboarding step 2: where the agent learns from. A quick look at the public
 * Instagram and website, then (if the owner agrees) a deeper read of the last
 * posts and the website's first page, which ends in a proposal to confirm. */
export function SourcesStep({ slug }: { slug: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const home = `/b/${encodeURIComponent(slug)}`;
  const [stage, setStage] = useState<Stage>("form");
  const [username, setUsername] = useState("");
  const [website, setWebsite] = useState("");
  const [preview, setPreview] = useState<SourcesPreview | null>(null);
  const [reading, setReading] = useState<Row[]>([]);
  const [state, setState] = useState<SourcesState | null>(null);
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

  const running = state?.scans.some((scan) => ["queued", "running"].includes(scan.status)) ?? false;
  useEffect(() => {
    if (stage !== "learning" || (state && !running)) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [stage, state, running, load]);

  async function look() {
    setBusy(true); setError("");
    // The website first (seconds), then Instagram (a little longer): each line
    // moves on its own as its read finishes.
    const order = ([website.trim() && "website", username.trim() && "instagram"].filter(Boolean)) as Row["source"][];
    const rows: Row[] = order.map((source, index) => ({ source, label: sourceLabel[source], progress: 0, state: index ? "waiting" : "running",
      step: index ? "Në radhë" : source === "website" ? "Po hapet faqja" : "Po lexohet profili" }));
    setReading(rows); setStage("reading");
    const update = (source: Row["source"], change: Partial<Row>) => setReading((current) => current.map((row) => row.source === source ? { ...row, ...change } : row));
    const found: SourcesPreview = { instagram: null, website: null, about: null };
    try {
      for (const source of order) {
        update(source, { state: "running", progress: 35, step: source === "website" ? "Po hapet faqja" : "Po lexohet profili dhe postimet e fundit" });
        const result = await post({ action: "preview", username, website, only: source }) as SourcesPreview;
        found[source] = result[source] as never;
        found.about = result.about ?? found.about;
        const failed = !!result[source] && "error" in result[source]!;
        update(source, { state: failed ? "failed" : "done", progress: 100, step: failed ? "Nuk u lexua" : "U lexua" });
      }
      setPreview(found);
      // A short pause so the finished bars are seen before the results.
      await new Promise((resolve) => setTimeout(resolve, 600));
      setStage("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nuk u lexua.");
      setStage("form");
    } finally { setBusy(false); }
  }
  async function learn() {
    setBusy(true); setError("");
    try { await post({ action: "learn" }); setStage("learning"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Analiza nuk nisi."); }
    finally { setBusy(false); }
  }

  const ig = preview?.instagram;
  const site = preview?.website;
  const canLearn = Boolean((ig && !("error" in ig)) || (site && !("error" in site)));
  const failed = state?.scans.filter((scan) => scan.status === "failed") ?? [];

  return (
    <>
      <div className="onboarding-progress">
        <progress max={2} value={stage === "form" ? 1 : 2} aria-label="Progresi i konfigurimit" />
        <span>Hapi 2 nga 2</span>
      </div>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">NGA KU TË MËSOJË AGJENTI</span>
        <h1>{stage === "form" ? "Ku e gjejnë klientët biznesin tënd?" : stage === "reading" ? "Po lexojmë profilin tënd" : stage === "preview" ? "Kjo është ajo që gjetëm" : state?.review ? "Agjenti mbaroi së mësuari" : "Agjenti po mëson"}</h1>
        <p>
          {stage === "form"
            ? "Shkruaj Instagram-in dhe website-in. Agjenti lexon vetëm atë që është publike; nuk kërkohet lidhja e llogarisë."
            : stage === "reading" ? "Zakonisht zgjat 10–20 sekonda."
            : stage === "preview"
              ? "Përshkrimi i përgjithshëm u ruajt te Njohuritë si \"Rreth biznesit\"."
              : state?.review ? "Shiko çfarë gjeti dhe konfirmo çfarë të përdorë në përgjigje."
              : "Kur të mbarojë, të tregojmë çfarë gjeti që ta konfirmosh. Mund të vazhdosh te paneli ndërkohë."}
        </p>
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
            <small className="onboarding-hint">Lidhja e Instagram-it për t&apos;u përgjigjur klientëve bëhet më vonë, si hapi i fundit te paneli.</small>
          </fieldset>
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <a className="onboarding-back" href={home}>Anashkalo</a>
            <div className="onboarding-actions-end">
              <button className="onboarding-next" type="submit" disabled={busy || (!username.trim() && !website.trim())}>
                {busy ? "Duke lexuar…" : "Vazhdo"}
              </button>
            </div>
          </div>
        </form>
      )}

      {stage === "reading" && <div className="onboarding-found"><ProgressRows rows={reading} /></div>}

      {stage === "preview" && preview && (
        <div className="onboarding-found">
          {ig && (
            <article className="onboarding-found-card">
              <span className="onboarding-found-icon is-instagram"><Icon name="instagram" size={20} /></span>
              <div>
                <h2>{"error" in ig ? `@${ig.username}` : ig.name || `@${ig.username}`}</h2>
                {"error" in ig ? <p className="onboarding-found-error">{ig.error}</p> : <>
                  {ig.name && <p className="onboarding-found-meta">@{ig.username}</p>}
                  {ig.biography && <p>{ig.biography}</p>}
                  {ig.website && <p className="onboarding-found-meta">{ig.website}</p>}
                </>}
              </div>
            </article>
          )}
          {site && (
            <article className="onboarding-found-card">
              <span className="onboarding-found-icon"><Icon name="display" size={20} /></span>
              <div>
                <h2>{"error" in site ? site.url : site.title || site.url}</h2>
                {"error" in site ? <p className="onboarding-found-error">{site.error}</p> : <>
                  {site.title && <p className="onboarding-found-meta">{site.url}</p>}
                  {site.description && <p>{site.description}</p>}
                </>}
              </div>
            </article>
          )}
          {canLearn ? (
            <div className="onboarding-found-question">
              <p><strong>Të vazhdojmë të mësojmë më shumë?</strong> Agjenti lexon {ig && !("error" in ig) ? `${ig.postCount} postimet e fundit të Instagram-it` : ""}{ig && !("error" in ig) && site && !("error" in site) ? " dhe " : ""}{site && !("error" in site) ? "faqen kryesore të website-it" : ""}, pastaj të tregon çfarë gjeti për ta konfirmuar.</p>
            </div>
          ) : null}
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <button type="button" className="onboarding-back" disabled={busy} onClick={() => { setStage("form"); setError(""); }}>Ndrysho</button>
            <div className="onboarding-actions-end">
              <a className="onboarding-skip" href={home}>{canLearn ? "Jo, mjafton kaq" : "Vazhdo te paneli"}</a>
              {canLearn && <button type="button" className="onboarding-next" disabled={busy} onClick={() => void learn()}>{busy ? "Duke nisur…" : "Po, vazhdo"}</button>}
            </div>
          </div>
        </div>
      )}

      {stage === "learning" && (
        <div className="onboarding-found">
          {state?.review ? (
            <SourcesReview slug={slug} review={state.review} onDone={() => window.location.assign(home)} />
          ) : (
            state && state.scans.length && running ? (
              <ProgressRows rows={state.scans.map((scan) => ({ source: scan.source, label: sourceLabel[scan.source],
                progress: scan.progress, step: scan.step,
                state: scan.status === "completed" ? "done" : scan.status === "failed" ? "failed" : scan.status === "queued" && scan.progress <= 5 ? "waiting" : "running" }))} />
            ) : (
              <div className="onboarding-learning" role="status">
                {running || !state ? <><span className="onboarding-spinner" aria-hidden="true" /> Po nis analiza…</>
                  : failed.length ? "Analiza nuk përfundoi. Mund ta provosh përsëri më vonë te Njohuritë."
                  : "Analiza mbaroi pa gjetur informacion të ri."}
              </div>
            )
          )}
          <div className="onboarding-actions">
            <span />
            <div className="onboarding-actions-end">
              <a className={state?.review ? "onboarding-skip" : "onboarding-next"} href={home}>
                {state?.review ? "Konfirmo më vonë" : running ? "Vazhdo te paneli ndërkohë" : "Vazhdo te paneli"}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
