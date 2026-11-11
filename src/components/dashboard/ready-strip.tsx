"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { launchBusiness } from "@/lib/setup/actions";
import type { Readiness, ReadinessStep } from "@/lib/setup/readiness";
import { ProfileQuestions } from "./profile-questions";
import "./ready-strip.css";

const ABOUT: Record<ReadinessStep["key"], string> = {
  profile: "Disa pyetje të shkurtra që Agjenti ta njohë biznesin. Mund t'i lësh edhe për më vonë.",
  knowledge: "Agjenti përgjigjet vetëm me atë që di: shto njohuritë ose produktet.",
  agent: "Si flet Agjenti me klientët dhe kur t'ia kalojë stafit.",
  test: "Shkruaji Agjentit si të ishe klient para se ta aktivizosh. E rekomanduar.",
  channel: "Lidh Instagram-in ose WhatsApp-in ku të shkruajnë klientët.",
  live: "Agjenti fillon t'u përgjigjet klientëve vetë. Mund ta ndalosh kur të duash.",
};
const SHORT: Record<ReadinessStep["key"], string> = {
  profile: "Profili", knowledge: "Njohuritë", agent: "Udhëzimet", test: "Prova", channel: "Kanali", live: "Aktivizo",
};

/** "Gati për klientët": the steps left before the agent answers customers, one
 * card above the assistant on Home until the agent is live. The profile
 * questions are answered in the card itself. */
export function ReadyStrip({ slug, readiness }: { slug: string; readiness: Readiness }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const required = readiness.steps.filter((step) => !step.recommended);
  const done = required.filter((step) => step.done).length;
  const next = readiness.steps.find((step) => !step.done && !step.recommended) ?? readiness.steps.find((step) => !step.done);
  const [chosen, setChosen] = useState<ReadinessStep["key"] | null>(null);
  if (readiness.live || !next) return null;
  const active = readiness.steps.find((step) => step.key === chosen) ?? next;

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

  return (
    <section className="ready-strip" aria-labelledby="ready-strip-title">
      <div className="ready-strip-head">
        <h2 id="ready-strip-title">Gati për klientët</h2>
        <span>{done} nga {required.length}</span>
      </div>
      <ol className="ready-strip-steps" style={{ gridTemplateColumns: `repeat(${readiness.steps.length}, minmax(0, 1fr))` }}>
        {readiness.steps.map((step) => (
          <li key={step.key}>
            <button type="button" aria-current={step.key === active.key ? "step" : undefined} onClick={() => setChosen(step.key)}
              className={`${step.done ? "is-done" : ""} ${step.key === active.key ? "is-active" : ""} ${step.recommended ? "is-optional" : ""}`}>
              <span className="ready-strip-bar" aria-hidden="true" />
              <span className="ready-strip-label">{step.done ? "✓ " : ""}{SHORT[step.key]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="ready-strip-body">
        {active.key === "profile" ? (
          <ProfileQuestions slug={slug} onFinished={() => { setChosen(null); router.refresh(); }} />
        ) : (
          <div className="ready-strip-step">
            <div>
              <h3>{active.title}{active.recommended ? <small> · i rekomanduar</small> : null}</h3>
              <p>{active.done ? "✓ U krye. " : ""}{ABOUT[active.key]}</p>
              {active.key === "live" && readiness.blocked && !active.done ? <p className="ready-strip-wait">{readiness.blocked}</p> : null}
              {active.key === "live" && !readiness.tested && !readiness.blocked ? <p className="ready-strip-wait">Rekomandohet një provë e Agjentit më parë.</p> : null}
            </div>
            <div className="ready-strip-actions">
              {active.key === "live"
                ? <button type="button" className="btn btn-primary" disabled={pending || !!readiness.blocked} onClick={activate}>{pending ? "Duke aktivizuar…" : "Aktivizo përgjigjet"}</button>
                : active.href ? <Link className={`btn ${active.done ? "btn-ghost" : "btn-primary"}`} href={active.href}>{active.done ? "Hap" : active.action}</Link> : null}
            </div>
          </div>
        )}
      </div>
      {error && <p className="ready-strip-error" role="alert">{error}</p>}
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
