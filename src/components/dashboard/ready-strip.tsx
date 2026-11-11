"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { launchBusiness } from "@/lib/setup/actions";
import type { Readiness } from "@/lib/setup/readiness";
import "./ready-strip.css";

/** "Gati për klientët": what is left before the agent answers customers,
 * above the assistant on the home page until the agent is live. */
export function ReadyStrip({ slug, readiness }: { slug: string; readiness: Readiness }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const required = readiness.steps.filter((step) => !step.recommended);
  const done = required.filter((step) => step.done).length;
  const next = readiness.steps.find((step) => !step.done && !step.recommended) ?? readiness.steps.find((step) => !step.done);
  if (readiness.live || !next) return null;

  function activate() {
    setError("");
    const data = new FormData();
    data.set("mode", "automatic");
    start(async () => {
      const result = await launchBusiness(slug, data).catch(() => ({ error: "Aktivizimi nuk u krye. Provo përsëri." }));
      if (result && "error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }
  const canActivate = next.key === "live" && !readiness.blocked;

  return (
    <section className="ready-strip" aria-labelledby="ready-strip-title">
      <div className="ready-strip-main">
        <div className="ready-strip-text">
          <h2 id="ready-strip-title">Gati për klientët · {done} nga {required.length}</h2>
          <p>Hapi tjetër: <strong>{next.title}</strong>{next.key === "live" && !readiness.tested ? " · rekomandohet një provë e Agjentit më parë" : ""}</p>
        </div>
        <div className="ready-strip-actions">
          {canActivate
            ? <button type="button" className="btn btn-primary" disabled={pending} onClick={activate}>{pending ? "Duke aktivizuar…" : "Aktivizo përgjigjet"}</button>
            : next.href ? <Link className="btn btn-primary" href={next.href}>{next.action}</Link> : null}
          <button type="button" className="ready-strip-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Fshih hapat" : "Shiko hapat"}</button>
        </div>
      </div>
      <div className="ready-strip-bar" aria-hidden="true"><span style={{ width: `${Math.round((done / required.length) * 100)}%` }} /></div>
      {error && <p className="ready-strip-error" role="alert">{error}</p>}
      {open && (
        <ol className="ready-strip-steps">
          {readiness.steps.map((step) => (
            <li key={step.key} className={step.done ? "is-done" : undefined}>
              <span className="ready-strip-mark" aria-hidden="true">{step.done ? "✓" : ""}</span>
              <span className="ready-strip-step">{step.title}{step.recommended ? <small> · i rekomanduar</small> : null}</span>
              {!step.done && (step.key === "live"
                ? (canActivate ? <button type="button" className="ready-strip-link" disabled={pending} onClick={activate}>Aktivizo</button> : <span className="ready-strip-wait">pas hapave të mësipërm</span>)
                : step.href ? <Link className="ready-strip-link" href={step.href}>{step.action} →</Link> : null)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Small header mark: is the agent answering customers right now. */
export function LiveMark({ slug, readiness }: { slug: string; readiness: Readiness }) {
  const channel = readiness.channel.instagram !== null ? "Instagram" : readiness.channel.whatsapp ? "WhatsApp" : "";
  const both = readiness.channel.instagram !== null && readiness.channel.whatsapp;
  return (
    <Link href={readiness.live ? `/b/${slug}/integrations` : `/b/${slug}`} className={`live-mark ${readiness.live ? "is-live" : ""}`}
      title={readiness.live ? "Agjenti u përgjigjet klientëve vetë" : "Agjenti nuk u përgjigjet ende klientëve vetë"}>
      <span className="live-mark-dot" aria-hidden="true" />
      {readiness.live ? `Live${channel ? ` · ${both ? "Instagram, WhatsApp" : channel}` : ""}` : "Jo live"}
    </Link>
  );
}
