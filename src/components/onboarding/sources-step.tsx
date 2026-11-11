"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import type { SourcesPreview } from "@/lib/discovery/sources-step";
import { onboardingQuestionsPath } from "@/lib/onboarding/steps";

type Stage = "form" | "reading" | "confirm";
type Decision = "yes" | "no" | null;
export type Row = { source: "instagram" | "website"; label: string; progress: number; step: string; state: "waiting" | "running" | "done" | "failed" };

export const sourceLabel = { instagram: "Instagram", website: "Website" } as const;

/** One line per source with its own bar, so the owner sees what is happening. */
export function ProgressRows({ rows }: { rows: Row[] }) {
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

/** Onboarding step 1, second screen: the Instagram and website given with the
 * name are read at once and shown (photo, name, numbers / logo, name); the
 * owner confirms each is theirs. The confirmed ones are then scanned in the
 * background (Instagram first, then the website) while the owner answers the
 * questions of step 2. */
export function SourcesStep({ slug, initialInstagram = "", initialWebsite = "" }: { slug: string; initialInstagram?: string; initialWebsite?: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const next = onboardingQuestionsPath(slug);
  const [stage, setStage] = useState<Stage>("form");
  const [username, setUsername] = useState(initialInstagram);
  const [website, setWebsite] = useState(initialWebsite);
  const [preview, setPreview] = useState<SourcesPreview | null>(null);
  const [reading, setReading] = useState<Row[]>([]);
  const [decision, setDecision] = useState<{ instagram: Decision; website: Decision }>({ instagram: null, website: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Veprimi nuk u krye. Provo përsëri.");
    return result;
  }, [endpoint]);
  // What was given with the name is read right away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || (!initialInstagram && !initialWebsite)) return;
    started.current = true;
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // The scan goes on in the background; the questions come next.
      window.location.assign(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Analiza nuk nisi."); setBusy(false); }
  }

  const ig = preview?.instagram;
  const site = preview?.website;
  const igOk = ig && !("error" in ig) ? ig : null;
  const siteOk = site && !("error" in site) ? site : null;
  const nothingConfirmed = decision.instagram === "no" && decision.website === "no";
  const title = stage === "form" ? "Ku e gjejnë klientët biznesin tënd?" : stage === "reading" ? "Po kërkojmë llogaritë e tua"
    : "A janë këto llogaritë e tua?";
  const lead = stage === "form" ? "Shkruaj Instagram-in dhe website-in. Agjenti lexon vetëm atë që është publike; nuk kërkohet lidhja e llogarisë."
    : stage === "reading" ? "Zakonisht zgjat 10–20 sekonda."
    : "Kontrollo foton, emrin dhe numrat. Agjenti lexon vetëm llogaritë që konfirmon, ndërsa ti u përgjigjesh disa pyetjeve.";

  return (
    <>
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
          {busy && <p className="onboarding-hint" role="status">Po nis leximi…</p>}
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">
            <button type="button" className="onboarding-back" disabled={busy} onClick={() => { setStage("form"); setError(""); }}>Ndrysho të dhënat</button>
            <div className="onboarding-actions-end">
              {nothingConfirmed && <a className="onboarding-next" href={next}>Vazhdo pa analizë</a>}
            </div>
          </div>
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
