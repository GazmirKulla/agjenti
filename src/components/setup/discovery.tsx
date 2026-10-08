"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { businessProfiles } from "@/lib/onboarding/rules";
import { DiscoveryScanDialog, type ScanJob } from "./scan-dialog";
import "./discovery.css";

type Job = ScanJob & { note: string; warnings: string[]; knowledgeCount?: number; inactiveKnowledgeCount?: number; contextPrepared?: boolean; website: string | null; canResume: boolean };
type State = { available: boolean; error?: string; connection: { username: string | null } | null; signals: { businessType: string } | null; confirmedAt: string | null; knowledgeCount?: number; pendingKnowledgeCount?: number; revision: number; intelligenceRevision: number; jobs: Job[] };

export function DiscoverySetup({ slug, businessId }: { slug: string; businessId: string }) {
  const router = useRouter();
  const endpoint = `/api/business-discovery?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingSource, setStartingSource] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [website, setWebsite] = useState("");
  const scanningIds = useRef<string[]>([]);
  const wasAnalyzing = useRef(false);
  const resumePending = useRef(false);
  const routingPending = useRef(false);
  const preparedAt = useRef<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data: State = await response.json();
    if (!response.ok) throw new Error(data.error || "Analiza nuk u ngarkua.");
    setState(data);
    if (data.confirmedAt && preparedAt.current !== data.confirmedAt) {
      const changed = preparedAt.current !== null;
      preparedAt.current = data.confirmedAt;
      if (changed) router.refresh();
    }
    if (preparedAt.current === null) preparedAt.current = "";
    return data;
  }, [endpoint, router]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await load();
        // Also drain bounded batches left by larger or older scans, without a
        // confirmation form. Explicit Knowledge exclusions are checked server-side.
        if (!cancelled && data.available && data.pendingKnowledgeCount && !data.jobs.some(job => ["queued", "running"].includes(job.status)) && !routingPending.current) {
          routingPending.current = true;
          try {
            const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "route_knowledge", revision: data.revision, intelligenceRevision: data.intelligenceRevision }) });
            const result = await response.json();
            if (!response.ok && result.code !== "stale_draft") throw new Error(result.error || "Njohuritë nuk u ruajtën.");
            if (response.ok && !cancelled) await load();
          } finally { routingPending.current = false; }
        }
        if (!cancelled && data.available && data.jobs.some(job => job.canResume) && !resumePending.current) {
          resumePending.current = true;
          try { await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume" }) }); }
          finally { resumePending.current = false; }
        }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : "Analiza nuk u ngarkua."); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [endpoint, load]);

  const active = state?.jobs.some(job => ["queued", "running"].includes(job.status)) ?? false;
  const analyzing = active || Boolean(startingSource);
  const activeIds = state?.jobs.filter(job => ["queued", "running"].includes(job.status)).map(job => job.id).join(",") ?? "";
  useEffect(() => {
    if (analyzing && !wasAnalyzing.current) { scanningIds.current = []; setScanOpen(true); }
    if (activeIds) scanningIds.current = [...new Set([...scanningIds.current, ...activeIds.split(",")])];
    wasAnalyzing.current = analyzing;
  }, [analyzing, activeIds]);
  const scanJobs = state?.jobs.filter(job => active ? ["queued", "running"].includes(job.status) || scanningIds.current.includes(job.id) : !startingSource && scanningIds.current.includes(job.id)) ?? [];
  const latest = (source: string) => state?.jobs.find(job => job.source === source);
  const ready = Boolean(state?.confirmedAt) && !analyzing;
  const home = `/b/${slug}`;
  const businessType = state?.signals?.businessType;
  const label = businessType && Object.hasOwn(businessProfiles, businessType) ? businessProfiles[businessType as keyof typeof businessProfiles].label : "Biznesi yt";
  const suggestion = state?.jobs.find(job => job.source === "instagram" && job.website)?.website;

  async function start(source: string, url?: string) {
    setBusy(true); setError(""); setStartingSource(source); setScanOpen(true);
    if (!active) scanningIds.current = [];
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", source, website: url, force: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Analiza nuk u nis.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Analiza nuk u nis."); }
    finally { setBusy(false); setStartingSource(""); }
  }
  return <section className="discovery discovery-context" aria-labelledby="discovery-title">
    <header className="discovery-header">
      <p className="setup-eyebrow">ONBOARDING · NJOHIM BIZNESIN TËND</p>
      <h1 id="discovery-title">{ready ? "Biznesi yt, gati për hapin tjetër." : "Lidh burimin. Ne kujdesemi për përgatitjen."}</h1>
      <p>Lexojmë postimet, fotot dhe website-in për të kuptuar biznesin dhe për të përgatitur njohuritë e Agjentit. Informacioni ruhet automatikisht.</p>
    </header>
    <ol className="discovery-context-steps" aria-label="Hapat e onboarding-ut">
      {["Lidh burimin", "Njohim biznesin", "Vazhdo në panel"].map((text, index) => <li key={text} className={ready || analyzing && index === 0 ? "is-done" : ""} aria-current={(ready ? 2 : analyzing ? 1 : 0) === index ? "step" : undefined}><span>{ready || analyzing && index === 0 ? "✓" : `0${index + 1}`}</span>{text}</li>)}
    </ol>
    {!state && <p className="discovery-loading" role="status"><span className="discovery-spinner" aria-hidden="true" /> Duke ngarkuar…</p>}
    {state && !state.available && <p className="discovery-error" role="status">{state.error}</p>}
    <DiscoveryScanDialog open={scanOpen} jobs={scanJobs} startingSource={startingSource} error={error} onClose={() => setScanOpen(false)} onReview={() => { setScanOpen(false); document.getElementById("discovery-result")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
    {analyzing && <button type="button" className="discovery-scan-launcher" onClick={() => setScanOpen(true)}><span className="discovery-spinner" aria-hidden="true" /><span><strong>Po njohim biznesin tënd</strong><small>Postimet na ndihmojnë të kuptojmë aktivitetin dhe pyetjet e klientëve.</small></span><span className="discovery-scan-launcher-action">Shiko analizën ↗</span></button>}
    {ready && <section id="discovery-result" className="discovery-context-result" aria-labelledby="discovery-result-title">
      <span className="discovery-context-ready">✓ PËRGATITJA U PËRFUNDUA</span>
      <h2 id="discovery-result-title">{label}</h2>
      <p>Profili dhe njohuritë janë përgatitur. Mund të vazhdosh menjëherë në panel dhe ta përshtatësh Agjentin gjatë përdorimit.</p>
      <div className="discovery-context-facts"><span>Lloji i biznesit <strong>{businessType === "other" ? "Profil i përgjithshëm" : label}</strong></span><span>Njohuri aktive <strong>{state?.knowledgeCount ?? 0}</strong></span><span>Produktet <strong>I shton më vonë</strong></span></div>
      <div className="discovery-actions"><Link className="btn btn-primary" href={home}>Vazhdo në panel →</Link><Link className="btn btn-ghost" href={`${home}/agents/test`}>Provo Agjentin</Link></div>
      <nav className="discovery-context-links" aria-label="Përshtatja e biznesit"><Link href={`${home}/knowledge`}>Shiko njohuritë ↗</Link><Link href={`${home}/settings#modules`}>Përshtat seksionet ↗</Link></nav>
    </section>}
    <div className="discovery-context-sources" aria-label="Burimet e biznesit">
      <article className="discovery-context-source">
        <span className="discovery-context-icon" aria-hidden="true">◎</span><div><h2>Instagram</h2><p>{state?.connection ? `@${state.connection.username || "Instagram"} · Llogaria është e lidhur` : "Lidh llogarinë e biznesit. Analiza nis automatikisht."}</p></div>
        {state?.connection ? <button className="btn btn-ghost" disabled={busy || active || !state.available} onClick={() => void start("instagram")}>{latest("instagram") ? "Analizo përsëri" : "Analizo postimet"}</button> : <a className="btn btn-primary" href={`/api/instagram/oauth/start?businessId=${businessId}`}>Lidh Instagram-in →</a>}
      </article>
      <article className="discovery-context-source discovery-context-website">
        <span className="discovery-context-icon" aria-hidden="true">↗</span><div><h2>Website <small>Opsional</small></h2><p>Plotësojmë njohuritë me informacionin e publikuar në website.</p>
        <form onSubmit={event => { event.preventDefault(); void start("website", website); }}><label className="sr-only" htmlFor="discovery-website">Website i biznesit</label><input id="discovery-website" className="field" type="url" placeholder="https://biznesi.al" value={website} onChange={event => setWebsite(event.target.value)} required maxLength={2000} /><button className="btn btn-ghost" disabled={busy || active || !state?.available}>Analizo →</button></form>
        {suggestion && !website && !latest("website") && <button type="button" className="soft-link" onClick={() => setWebsite(suggestion)}>Përdor website-in nga profili</button>}</div>
      </article>
    </div>
    {state?.jobs.some(job => job.status === "failed") && <div className="discovery-context-retries">{[latest("instagram"), latest("website")].filter((job): job is Job => Boolean(job && job.status === "failed")).map(job => <div key={job.id}><p role="status">{job.error || "Ky burim kërkon një provë tjetër."}</p><button type="button" className="btn btn-ghost" disabled={busy || active} onClick={() => void start(job.source, job.website ?? undefined)}>Provo përsëri</button></div>)}</div>}
    {state && state.jobs.length > 0 && <details className="discovery-context-details"><summary>Detajet e analizës</summary>{[latest("instagram"), latest("website")].filter((job): job is Job => Boolean(job)).map(job => <div key={job.id}><strong>{job.source === "instagram" ? "Instagram" : "Website"} · {job.status === "completed" ? "Përfundoi" : `${job.progress}%`}</strong><p>{job.note}</p>{Boolean(job.inactiveKnowledgeCount) && <p>{job.inactiveKnowledgeCount} përgjigje kundërshtuese u ruajtën joaktive te Njohuritë. Mund t’i kontrollosh më vonë.</p>}{job.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>)}</details>}
    {error && <p className="discovery-error" role="alert">{error}</p>}
    {!ready && <p className="discovery-context-later">Produktet, çmimet dhe workflow-t i shton më vonë në panel. <Link href={home}>Vazhdo tani →</Link></p>}
  </section>;
}
