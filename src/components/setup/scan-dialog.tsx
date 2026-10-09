"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IMAGE_BATCH_SIZE } from "@/lib/discovery/images";
import type { ScanPreview } from "@/lib/discovery/previews";
import "./scan-dialog.css";

export type ScanJob = {
  id: string; source: "instagram" | "website"; status: string; stage: string;
  progress: number; error: string | null; postCount: number; imageCount: number;
  previews?: ScanPreview[]; pageCount?: number; nextImage?: number;
};
const stageCopy: Record<string, string> = {
  capture: "Leximi i postimeve",
  text: "Leximi i teksteve",
  images: "Analiza e fotove",
  finish: "Përgatitja e biznesit",
};

export function DiscoveryScanDialog({ open, jobs, startingSource, error, onClose, onReview }: {
  open: boolean; jobs: ScanJob[]; startingSource: string; error: string;
  onClose: () => void; onReview: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const running = jobs.some(job => ["queued", "running"].includes(job.status)) || Boolean(startingSource);
  const finished = !running && jobs.length > 0 && jobs.every(job => job.status === "completed");
  const failedJob = jobs.find(job => job.status === "failed");
  const failure = !running && !finished && (error || failedJob?.error || (failedJob ? "Analiza u ndërpre. Provo përsëri." : ""));
  const job = startingSource
    ? jobs.find(job => job.source === startingSource && ["queued", "running"].includes(job.status))
    : jobs.find(job => job.id === selectedId) ?? jobs.find(job => ["queued", "running"].includes(job.status)) ?? jobs[0];
  const source = startingSource || job?.source || "instagram";
  const allPreviews = job?.previews ?? [];
  // During visual analysis, cycle the actual current batch rather than claiming
  // unrelated photos are being processed by the worker at that moment.
  const offset = job?.nextImage ?? 0;
  const previews = job?.source === "instagram" && job.stage === "images" && offset < allPreviews.length ? allPreviews.slice(offset, offset + IMAGE_BATCH_SIZE) : allPreviews;
  const progress = finished ? 100 : job?.progress ?? 0;
  const previewKey = `${job?.id}:${job?.stage}:${offset}`;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { if (element.open) element.close(); return; }
    if (!element.open) element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; if (element.open) element.close(); };
  }, [open]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => { setFrame(0); }, [previewKey]);
  useEffect(() => {
    if (!open || !running || paused || reducedMotion || previews.length < 2) return;
    const timer = setInterval(() => { if (!document.hidden) setFrame(value => value + 1); }, 3200);
    return () => clearInterval(timer);
  }, [open, running, paused, reducedMotion, previews.length]);

  return <dialog ref={dialog} className="scan-dialog" aria-labelledby="scan-title" aria-describedby="scan-description" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`scan-content${finished ? " is-complete" : ""}${failure ? " is-failed" : ""}`}>
      <header className="scan-topline">
        <span className="scan-wordmark"><ScanGlyph /> Agjenti</span>
        <button className="scan-close" type="button" onClick={onClose} aria-label={running ? "Minimizo analizën" : "Mbyll analizën"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
      </header>
      <div className="scan-heading">
        <h2 id="scan-title">{finished ? "Gati" : failure ? "Analiza u ndërpre" : "Po analizojmë"}</h2>
        <p id="scan-description" className="sr-only">{finished ? "Profili dhe njohuritë u përgatitën. Mund të vazhdosh në panel." : failure ? "Progresi u ruajt. Provo përsëri nga onboarding." : "Analiza vazhdon edhe kur e minimizon këtë dritare."}</p>
        {!finished && !failure && jobs.length <= 1 && <span className="scan-live"><i />{source === "website" ? "Website" : "Instagram"}</span>}
      </div>
      {jobs.length > 1 && <nav className="scan-sources" aria-label="Burimet në analizë">{jobs.map(item => <button key={item.id} type="button" aria-pressed={item.id === job?.id} onClick={() => setSelectedId(item.id)}>{item.source === "instagram" ? "Instagram" : "Website"}<span>{item.status === "completed" ? "✓" : `${item.progress}%`}</span></button>)}</nav>}
      {finished ? <div className="scan-success"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" /><path d="m20 32 8 8 16-17" /></svg></div> : <>
        <div className="scan-carousel" aria-label={source === "website" ? "Faqet e lexuara nga website-i" : "Postimet e përzgjedhura për analizë"}>
          {previews.length ? previews.map((item, index) => {
            const count = previews.length;
            let position = (index - frame % count + count) % count;
            if (position > count / 2) position -= count;
            if (Math.abs(position) > 2) return null;
            return <Preview key={`${job?.id}:${item.id}`} item={item} source={source} position={position} scanning={running && job?.status !== "completed" && !job?.error} />;
          }) : [-1, 0, 1].map(position => <div className={`scan-frame scan-placeholder${position === 0 ? " is-focused" : ""}`} key={position} style={{ "--position": position, "--distance": Math.abs(position) } as CSSProperties} aria-hidden="true"><div className="scan-placeholder-icon"><ScanGlyph /></div><div className="scan-skeleton-line" /><div className="scan-skeleton-line is-short" />{position === 0 && running && <div className="scan-sweep" />}</div>)}
        </div>
        <div className="scan-caption">
          <span className="scan-source-label">{previews.length > 0 ? `${source === "website" ? "Faqja" : "Postimi"} ${frame % previews.length + 1} / ${previews.length}${source === "instagram" && job?.stage === "images" ? " · grupi aktual" : ""}` : "Duke ngarkuar…"}</span>
          {running && previews.length > 1 && !reducedMotion && <button type="button" className="scan-motion-toggle" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? "Rifillo rrotullimin" : "Ndalo rrotullimin"} title={paused ? "Rifillo rrotullimin" : "Ndalo rrotullimin"}><svg viewBox="0 0 20 20" aria-hidden="true">{paused ? <path d="m7 4 8 6-8 6Z" /> : <><path d="M7 5v10" /><path d="M13 5v10" /></>}</svg></button>}
        </div>
      </>}
      <div className="scan-status" role="status" aria-live="polite">
        <div className="scan-status-line"><span>{finished ? "Biznesi u përgatit" : job?.status === "completed" ? "Burimi u analizua" : job?.error ? "Në pritje të riprovimit" : source === "website" && job?.stage === "capture" ? "Leximi i faqeve" : source === "website" && job?.stage === "images" ? "Analiza e faqeve" : stageCopy[job?.stage ?? "capture"] ?? "Po përgatitet"}</span><strong>{progress}%</strong></div>
        <div className="scan-progress-track" role="progressbar" aria-label="Progresi i analizës" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
      </div>
      {(failure || job?.error) && <p className="scan-error" role="alert">{failure || job?.error}</p>}
      <footer className="scan-footer">
        <p>{finished ? `${jobs.reduce((sum, item) => sum + (item.source === "instagram" ? item.postCount : item.pageCount ?? 0), 0)} ${jobs.every(item => item.source === "website") ? "faqe të lexuara" : jobs.every(item => item.source === "instagram") ? "postime të lexuara" : "postime dhe faqe të lexuara"}` : failure ? "Progresi u ruajt" : "Vazhdon në sfond"}</p>
        <button type="button" className={`scan-footer-action${finished ? " is-primary" : ""}`} onClick={finished ? onReview : onClose}>{finished ? "Vazhdo" : running ? "Minimizo" : "Kthehu"}<span aria-hidden="true">{running ? "↘" : "→"}</span></button>
      </footer>
    </div>
  </dialog>;
}

function Preview({ item, source, position, scanning }: { item: ScanPreview; source: string; position: number; scanning: boolean }) {
  const [failed, setFailed] = useState(false);
  return <article className={`scan-frame${position === 0 ? " is-focused" : ""}${!item.imageUrl || failed ? " is-document" : ""}`} style={{ "--position": position, "--distance": Math.abs(position) } as CSSProperties} aria-hidden={position !== 0}>
    {item.imageUrl && !failed ? <Image src={item.imageUrl} width={256} height={320} unoptimized alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <div className="scan-document"><ScanGlyph /><span>{source === "website" ? "Website" : "Instagram"}</span><h3>{item.title}</h3><p>{item.excerpt || "Duke ngarkuar…"}</p><div className="scan-document-lines"><i /><i /><i /></div></div>}
    {item.imageUrl && !failed && <div className="scan-frame-bottom"><strong>{item.title}</strong></div>}
    {position === 0 && scanning && <div className="scan-sweep" aria-hidden="true" />}
  </article>;
}

function ScanGlyph() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 3H5a2 2 0 0 0-2 2v6M21 3h6a2 2 0 0 1 2 2v6M29 21v6a2 2 0 0 1-2 2h-6M11 29H5a2 2 0 0 1-2-2v-6M16 8v16M8 16h16M11 11l10 10M21 11 11 21" /></svg>;
}
