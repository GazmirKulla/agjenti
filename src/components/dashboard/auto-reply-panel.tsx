"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAutoReply } from "@/lib/setup/auto-reply-actions";
import type { Readiness } from "@/lib/setup/readiness";
import "./ready-strip.css";

/** On Kanalet: whether the agent answers customers by itself, and the switch. */
export function AutoReplyPanel({ slug, readiness }: { slug: string; readiness: Readiness }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmUntested, setConfirmUntested] = useState(false);
  const [pending, start] = useTransition();
  const connected = readiness.channel.instagram !== null || readiness.channel.whatsapp;

  function change(enabled: boolean) {
    if (enabled && !readiness.tested && !confirmUntested) { setConfirmUntested(true); return; }
    setMessage(null);
    start(async () => {
      const result: { error?: string; success?: string } = await setAutoReply(slug, enabled).catch(() => ({ error: "Ndryshimi nuk u ruajt." }));
      setConfirmUntested(false);
      if (result.error) setMessage({ text: result.error, error: true });
      else { setMessage({ text: result.success ?? "U ruajt." }); router.refresh(); }
    });
  }

  return (
    <section className={`auto-reply-panel ${readiness.live ? "is-live" : ""}`} aria-labelledby="auto-reply-title">
      <div className="auto-reply-main">
        <span className="live-mark-dot" aria-hidden="true" />
        <div className="auto-reply-text">
          <h2 id="auto-reply-title">{readiness.live ? "Agjenti u përgjigjet klientëve vetë" : "Përgjigjet automatike janë të fikura"}</h2>
          <p>
            {readiness.live ? "Mesazhet e reja në kanalet e lidhura marrin përgjigje nga Agjenti. Mund t'i fikësh kurdo dhe t'u përgjigjesh vetë."
              : !connected ? "Lidh Instagram-in ose WhatsApp-in më poshtë; pastaj aktivizo përgjigjet automatike këtu."
              : readiness.blocked ? `Ende mungon: ${readiness.blocked}`
              : "Kanali është gati. Kur i aktivizon, Agjenti u përgjigjet klientëve me njohuritë dhe udhëzimet e tua."}
          </p>
        </div>
        <div className="auto-reply-actions">
          {readiness.live
            ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => change(false)}>{pending ? "Duke fikur…" : "Fik"}</button>
            : connected && !readiness.blocked && <button type="button" className="btn btn-primary" disabled={pending} onClick={() => change(true)}>{pending ? "Duke aktivizuar…" : "Aktivizo"}</button>}
        </div>
      </div>
      {confirmUntested && (
        <div className="auto-reply-confirm" role="alertdialog" aria-label="Agjenti nuk është provuar">
          <p>Nuk e ke provuar ende Agjentin. Rekomandojmë një provë 2 minutëshe para se t&apos;u përgjigjet klientëve.</p>
          <div>
            <Link className="btn btn-ghost" href={`/b/${slug}/agents/test`}>Provo tani</Link>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => change(true)}>Aktivizo gjithsesi</button>
          </div>
        </div>
      )}
      {message && <p className={message.error ? "ready-strip-error" : "auto-reply-ok"} role={message.error ? "alert" : "status"}>{message.text}</p>}
    </section>
  );
}
