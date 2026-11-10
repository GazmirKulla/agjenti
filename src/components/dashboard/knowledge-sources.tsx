"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icon";
import "./knowledge-sources.css";

type Job = { id: string; source: "instagram" | "website"; status: string; created_at?: string; website?: string | null; error?: string | null; postCount?: number };
type State = {
  available: boolean; error?: string;
  connection: { username: string | null } | null;
  instagramUsername: string | null; publicScanAvailable: boolean; publicScanUsed?: boolean;
  knowledgeCount?: number; jobs: Job[];
};

const running = (job?: Job) => job && ["queued", "running"].includes(job.status);
function status(job?: Job) {
  if (!job) return "Ende pa analizuar";
  if (running(job)) return "Po analizohet…";
  if (job.status === "completed") return job.postCount ? `Analizuar · ${job.postCount} postime` : "Analizuar";
  return job.error || "Analiza nuk përfundoi";
}

/** Where the agent learns from: the business's Instagram (connected or by
 * public username) and website. Results become Knowledge on this page. */
export function KnowledgeSources({ slug }: { slug: string }) {
  const endpoint = `/api/business-discovery?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [username, setUsername] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json().catch(() => null) as State | null;
    if (response.ok && data) setState(data);
    return data;
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const instagramJob = state?.jobs.find((j) => j.source === "instagram");
  const websiteJob = state?.jobs.find((j) => j.source === "website");
  const scanning = running(instagramJob) || running(websiteJob);
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [scanning, load]);

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Veprimi nuk u krye. Provo përsëri.");
      setMessage({ text: typeof result.waiting === "boolean" && result.waiting
        ? "Username u ruajt. Leximi me username po aktivizohet; Instagram-i do të analizohet vetë sapo të jetë gati."
        : success });
      if (body.action === "instagram_username") setUsername("");
      if (body.source === "website") setWebsite("");
      await load();
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Veprimi nuk u krye.", error: true }); }
    finally { setBusy(false); }
  }

  if (!state) return <section className="knowledge-sources" aria-busy="true"><p className="muted-copy">Duke ngarkuar burimet…</p></section>;
  if (!state.available) return null;
  const connected = state.connection?.username;
  const saved = state.instagramUsername;
  return (
    <section className="knowledge-sources" aria-labelledby="knowledge-sources-title">
      <header>
        <h2 id="knowledge-sources-title">Nga ku mëson Agjenti</h2>
        <p>Agjenti lexon Instagram-in dhe website-in e biznesit dhe i shton njohuritë këtu. Ndryshimet që bën ti nuk mbishkruhen.</p>
      </header>
      <div className="knowledge-source-grid">
        <article className="knowledge-source">
          <span className="knowledge-source-icon is-instagram"><Icon name="instagram" size={20} /></span>
          <div className="knowledge-source-body">
            <h3>Instagram</h3>
            {connected ? <>
              <p>@{connected} · llogaria e lidhur te Kanalet</p>
              <p className="knowledge-source-status">{status(instagramJob)}</p>
              <button type="button" className="btn btn-ghost" disabled={busy || !!running(instagramJob)}
                onClick={() => void post({ action: "start", source: "instagram", force: true }, "Analiza nisi. Njohuritë shfaqen këtu kur të përfundojë.")}>
                {instagramJob ? "Analizo përsëri" : "Analizo postimet"}
              </button>
            </> : <>
              <p>{saved ? `@${saved} · profili publik` : "Shkruaj username-in që Agjenti të mësojë nga profili dhe 10 postimet e fundit publike."}</p>
              {saved && <p className="knowledge-source-status">{instagramJob ? status(instagramJob) : state.publicScanAvailable ? "Ende pa analizuar" : "Do të analizohet sapo leximi me username të aktivizohet"}</p>}
              {state.publicScanUsed ? (
                <p className="knowledge-source-hint">Profili publik analizohet vetëm një herë.</p>
              ) : <>
                <form className="knowledge-source-form" onSubmit={(e) => { e.preventDefault(); void post({ action: "instagram_username", username }, state.publicScanAvailable ? "Username u ruajt dhe analiza nisi." : "Username u ruajt."); }}>
                  <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={saved ? `@${saved}` : "@dyqani.im"}
                    aria-label="Username i Instagram-it" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={80} />
                  <button className="btn btn-primary" type="submit" disabled={busy || !username.trim()}>{saved ? "Ndrysho" : "Ruaj"}</button>
                </form>
                {saved && state.publicScanAvailable && !running(instagramJob) && (
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void post({ action: "instagram_username", username: saved }, "Analiza nisi.")}>
                    {instagramJob ? "Provo përsëri" : "Analizo tani"}
                  </button>
                )}
              </>}
              <p className="knowledge-source-hint">Për analizë më të plotë dhe për bisedat, <Link href={`/b/${slug}/integrations`}>lidhe Instagram-in te Kanalet</Link>.</p>
            </>}
          </div>
        </article>
        <article className="knowledge-source">
          <span className="knowledge-source-icon"><Icon name="display" size={20} /></span>
          <div className="knowledge-source-body">
            <h3>Website</h3>
            <p>{websiteJob?.website ?? "Shto faqen e biznesit që Agjenti të lexojë ofertën dhe kontaktet."}</p>
            {websiteJob && <p className="knowledge-source-status">{status(websiteJob)}</p>}
            <form className="knowledge-source-form" onSubmit={(e) => { e.preventDefault(); void post({ action: "start", source: "website", website, force: true }, "Analiza e website-it nisi."); }}>
              <input className="field" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder={websiteJob?.website ?? "https://"}
                aria-label="Adresa e website-it" maxLength={2000} />
              <button className="btn btn-primary" type="submit" disabled={busy || !website.trim() || !!running(websiteJob)}>Analizo</button>
            </form>
          </div>
        </article>
      </div>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "knowledge-source-error" : "knowledge-source-message"}>{message.text}</p>}
      <Link className="soft-link knowledge-source-more" href={`/b/${slug}/sources`}>Shiko analizën e plotë →</Link>
    </section>
  );
}
