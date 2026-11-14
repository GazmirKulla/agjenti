"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./conversation-training.css";

type Session = {
  id: string; source: "inbox" | "instagram_export"; status: "uploading" | "queued" | "running" | "ready" | "failed" | "cancelled";
  stage: string; progress: { done?: number; total?: number; label?: string }; error: string | null;
  stats: { conversations?: number; messages?: number; duplicates?: number; customerMessages?: number; ownerMessages?: number; agentMessages?: number; skippedFiles?: number; groupConversations?: number; firstAt?: string | null; lastAt?: string | null; warnings?: string[] };
  created_at: string; expires_at: string;
};
type State = { sessions: Session[]; keptMessages: number };

const ACTIVE = new Set(["uploading", "queued", "running"]);
const date = (value?: string | null) => (value ? new Date(value).toLocaleDateString("sq-AL", { day: "numeric", month: "short", year: "numeric" }) : "");
const MAX_BYTES = 100 * 1024 * 1024;

/** Steps 1–2 of training: choose where the conversations come from, then follow the import. */
export function ConversationTraining({ slug }: { slug: string }) {
  const endpoint = `/api/conversation-training?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "inbox" | "upload" | "delete">("");
  const [uploaded, setUploaded] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [ownerName, setOwnerName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Importet nuk u ngarkuan."); return null; }
    setState(data);
    return data as State;
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);
  const active = state?.sessions.find((s) => ACTIVE.has(s.status));
  // While an import runs, its progress is read every few seconds.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Veprimi nuk u krye. Provo përsëri.");
    return data;
  }

  async function fromInbox() {
    setBusy("inbox"); setError("");
    try { await post({ action: "inbox" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Importi nuk u nis."); }
    finally { setBusy(""); }
  }

  async function upload() {
    if (!files.length) return;
    setBusy("upload"); setError(""); setUploaded(0);
    try {
      const prepared = await post({ action: "upload", files: files.map((f) => ({ name: f.name, size: f.size })), ownerName: ownerName.trim() || undefined });
      for (const [i, target] of (prepared.uploads as { url: string }[]).entries()) {
        const file = files[i];
        const response = await fetch(target.url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
        if (!response.ok) {
          await post({ action: "delete", id: prepared.id }).catch(() => null);
          throw new Error(`«${file.name}» nuk u ngarkua. Kontrollo lidhjen dhe provo përsëri.`);
        }
        setUploaded(i + 1);
      }
      await post({ action: "uploaded", id: prepared.id });
      setFiles([]);
      if (input.current) input.current.value = "";
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Ngarkimi nuk u krye."); }
    finally { setBusy(""); }
  }

  async function remove(id?: string) {
    const all = !id;
    if (!window.confirm(all ? "Të fshihen të gjitha bisedat e importuara? Kjo nuk kthehet pas." : "Të fshihet ky import dhe mesazhet që solli?")) return;
    setBusy("delete"); setError("");
    try { await post(all ? { action: "delete_all" } : { action: "delete", id }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fshirja nuk u krye."); }
    finally { setBusy(""); }
  }

  function choose(list: FileList | null) {
    const chosen = [...(list ?? [])].slice(0, 20);
    const large = chosen.find((f) => f.size > MAX_BYTES);
    setError(large ? `«${large.name}» është më i madh se 100 MB. Shkarko nga Instagram vetëm «Mesazhet».` : "");
    setFiles(large ? [] : chosen);
  }

  const disabled = !!busy || !!active;
  return (
    <div className="training">
      <ol className="training-steps" aria-label="Hapat">
        {["Burimi", "Importi", "Çfarë mësoi", "Miratimi", "Prova", "Aplikimi"].map((label, i) => (
          <li key={label} className={i === 0 || (i === 1 && (active || state?.sessions.length)) ? "is-current" : ""}><span>{i + 1}</span>{label}</li>
        ))}
      </ol>

      <section className="training-card" aria-labelledby="training-source">
        <h2 id="training-source">1. Nga cilat biseda të mësojë?</h2>
        <div className="training-sources">
          <div className="training-source">
            <h3>Bisedat në Agjenti</h3>
            <p>Bisedat e Instagram-it dhe WhatsApp-it që janë tashmë te Inbox-i (deri në një vit), edhe historia që Instagram jep për to.</p>
            <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void fromInbox()}>
              {busy === "inbox" ? "Po nis…" : "Lexo bisedat e Inbox-it"}
            </button>
          </div>
          <div className="training-source">
            <h3>Historia nga Instagram</h3>
            <p>Në Instagram: <b>Cilësimet → Qendra e llogarive → Informacioni yt → Shkarko informacionin</b>. Zgjidh vetëm <b>Mesazhet</b>, formatin <b>JSON</b> (ose HTML), dhe ngarko këtu skedarin ZIP.</p>
            <input ref={input} type="file" className="field" accept=".zip,.json,.html,.htm,application/zip,application/json,text/html" multiple disabled={disabled} onChange={(e) => choose(e.target.files)} />
            <label className="training-owner">
              <span>Emri i llogarisë në Instagram <em>(opsionale)</em></span>
              <input className="field" value={ownerName} maxLength={120} disabled={disabled} placeholder="P.sh. Watchmaster" onChange={(e) => setOwnerName(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={disabled || !files.length} onClick={() => void upload()}>
              {busy === "upload" ? `Po ngarkoj ${uploaded}/${files.length}…` : files.length > 1 ? `Ngarko ${files.length} skedarë` : "Ngarko eksportin"}
            </button>
          </div>
        </div>
        <p className="training-note">Gjatë trajnimit nuk i dërgohet asnjë mesazh klientëve dhe nuk ndryshon asgjë te Agjenti. Emrat, telefonat dhe email-et hiqen. Bisedat e importuara fshihen vetë pas 30 ditësh, ose kur t&apos;i fshish ti.</p>
        {error && <p className="training-error" role="alert">{error}</p>}
      </section>

      {!!state?.sessions.length && (
        <section className="training-card" aria-labelledby="training-imports">
          <h2 id="training-imports">2. Importet</h2>
          <ul className="training-sessions">
            {state.sessions.map((s) => {
              const pct = s.progress.total ? Math.min(100, Math.round(((s.progress.done ?? 0) / s.progress.total) * 100)) : ACTIVE.has(s.status) ? 5 : 100;
              return (
                <li key={s.id} className={`training-session is-${s.status}`}>
                  <div className="training-session-head">
                    <b>{s.source === "inbox" ? "Inbox-i" : "Eksporti i Instagram-it"}</b>
                    <span>{date(s.created_at)}</span>
                  </div>
                  {ACTIVE.has(s.status) && (
                    <>
                      <div className="training-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
                      <p className="training-note">{s.status === "uploading" ? "Po ngarkohet…" : s.progress.label || "Në radhë…"} Mund ta mbyllësh faqen: vazhdon vetë.</p>
                    </>
                  )}
                  {s.status === "ready" && (
                    <p className="training-note">
                      {s.stats.conversations ?? 0} biseda, {s.stats.messages ?? 0} mesazhe të reja
                      {s.stats.duplicates ? ` (${s.stats.duplicates} ishin lexuar më parë)` : ""}.
                      {" "}Klientët: {s.stats.customerMessages ?? 0} · Ti: {s.stats.ownerMessages ?? 0}{s.stats.agentMessages ? ` · Agjenti: ${s.stats.agentMessages}` : ""}.
                      {s.stats.firstAt && ` Nga ${date(s.stats.firstAt)} deri ${date(s.stats.lastAt)}.`}
                      {s.stats.groupConversations ? ` ${s.stats.groupConversations} biseda grupi u anashkaluan.` : ""}
                      {s.stats.skippedFiles ? ` ${s.stats.skippedFiles} skedarë nuk u lexuan.` : ""}
                    </p>
                  )}
                  {s.stats.warnings?.map((w) => <p key={w} className="training-warning">{w}</p>)}
                  {(s.status === "failed" || s.status === "cancelled") && <p className="training-error">{s.error || "Importi nuk përfundoi."}</p>}
                  <button type="button" className="btn btn-ghost training-delete" disabled={!!busy} onClick={() => void remove(s.id)}>Fshi</button>
                </li>
              );
            })}
          </ul>
          <p className="training-note">
            {state.keptMessages} mesazhe të ruajtura për trajnim. Hapi tjetër (analiza dhe çfarë mësoi Agjenti) vjen së shpejti.{" "}
            {state.keptMessages > 0 && <button type="button" className="training-link" disabled={!!busy} onClick={() => void remove()}>Fshi të gjitha</button>}
          </p>
        </section>
      )}
    </div>
  );
}
