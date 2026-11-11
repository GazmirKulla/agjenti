"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { launchBusiness } from "@/lib/setup/actions";
import type { Readiness, ReadinessStep } from "@/lib/setup/readiness";
import { ProfileQuestions } from "./profile-questions";
import { Icon } from "./icon";
import { SourcesStep } from "@/components/onboarding/sources-step";
import "@/app/onboarding/onboarding.css";
import "./ready-strip.css";

const ABOUT: Record<ReadinessStep["key"], string> = {
  sources: "Agjenti lexon profilin publik të Instagram-it dhe faqet e website-it, dhe krijon njohuritë e para. Pa lidhur llogarinë.",
  profile: "Disa pyetje të shkurtra që Agjenti ta njohë biznesin. Mund t'i lësh edhe për më vonë.",
  knowledge: "Agjenti përgjigjet vetëm me atë që di: shto njohuritë ose produktet.",
  agent: "Si flet Agjenti me klientët dhe kur t'ia kalojë stafit.",
  test: "Shkruaji Agjentit si të ishe klient para se ta aktivizosh.",
  channel: "Lidh Instagram-in ose WhatsApp-in ku të shkruajnë klientët.",
  live: "Agjenti fillon t'u përgjigjet klientëve vetë. Mund ta ndalosh kur të duash.",
};
const SHORT: Record<ReadinessStep["key"], string> = {
  sources: "Burimet", profile: "Profili", knowledge: "Njohuritë", agent: "Udhëzimet", test: "Prova", channel: "Kanali", live: "Aktivizo",
};
const ICON: Record<ReadinessStep["key"], string> = {
  sources: "link", profile: "store", knowledge: "knowledge", agent: "agents", test: "chat", channel: "integrations", live: "spark",
};

/** "Gati për klientët": the steps left before the agent answers customers, at
 * the top of Home until the agent is live. Sources and the profile questions
 * are done in the card itself; the other steps open where they are done. */
export function ReadyStrip({ slug, readiness }: { slug: string; readiness: Readiness }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [learning, setLearning] = useState(false);
  const required = readiness.steps.filter((step) => !step.recommended);
  const done = required.filter((step) => step.done).length;
  const next = readiness.steps.find((step) => !step.done && !step.recommended) ?? readiness.steps.find((step) => !step.done);
  const [chosen, setChosen] = useState<ReadinessStep["key"] | null>(null);
  if (readiness.live || !next) return null;
  const active = readiness.steps.find((step) => step.key === chosen) ?? next;
  const percent = Math.round((done / Math.max(1, required.length)) * 100);

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
    <section className="ready-card" aria-labelledby="ready-card-title">
      <header className="ready-head">
        <span className="ready-ring" style={{ "--ready": `${percent}%` } as React.CSSProperties} aria-hidden="true"><span>{done}/{required.length}</span></span>
        <div>
          <h2 id="ready-card-title">Gati për klientët</h2>
          <p>Hapi tjetër: <strong>{next.title}</strong></p>
        </div>
      </header>
      <ol className="ready-steps" aria-label="Hapat">
        {readiness.steps.map((step, index) => (
          <li key={step.key} className={`${step.done ? "is-done" : ""} ${step.key === active.key ? "is-active" : ""} ${step.recommended ? "is-optional" : ""}`}>
            <button type="button" aria-current={step.key === active.key ? "step" : undefined} onClick={() => setChosen(step.key)}
              aria-label={`${SHORT[step.key]}${step.done ? ", u krye" : ""}${step.recommended ? ", i rekomanduar" : ""}`}>
              <span className="ready-dot" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
              <span className="ready-step-label">{SHORT[step.key]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="ready-body">
        <div className="ready-body-head">
          <span className="ready-icon" aria-hidden="true"><Icon name={ICON[active.key]} size={20} /></span>
          <div>
            <h3>{active.title}{active.recommended && <span className="ready-chip">i rekomanduar</span>}{active.done && <span className="ready-chip is-done">✓ u krye</span>}</h3>
            <p>{ABOUT[active.key]}</p>
          </div>
        </div>
        {active.key === "profile" ? (
          <ProfileQuestions slug={slug} onFinished={() => { setChosen(null); router.refresh(); }} />
        ) : active.key === "sources" && !active.done && !learning ? (
          <div className="ready-sources"><SourcesStep slug={slug} compact onLearning={() => { setLearning(true); router.refresh(); }} /></div>
        ) : active.key === "sources" ? (
          <div className="ready-actions">
            {learning && <p className="ready-note" role="status">Agjenti po lexon burimet. Njohuritë që gjen i konfirmon te Njohuritë.</p>}
            <Link className="btn btn-ghost" href={active.href ?? "#"}>Shiko njohuritë</Link>
          </div>
        ) : (
          <div className="ready-actions">
            {active.key === "live" && readiness.blocked && !active.done ? <p className="ready-note">{readiness.blocked}</p> : null}
            {active.key === "live" && !readiness.tested && !readiness.blocked ? <p className="ready-note">Rekomandohet një provë e Agjentit më parë.</p> : null}
            {active.key === "live"
              ? <button type="button" className="btn btn-primary" disabled={pending || !!readiness.blocked} onClick={activate}>{pending ? "Duke aktivizuar…" : "Aktivizo përgjigjet"}</button>
              : active.href ? <Link className={`btn ${active.done ? "btn-ghost" : "btn-primary"}`} href={active.href}>{active.done ? "Hap" : active.action}</Link> : null}
          </div>
        )}
      </div>
      {error && <p className="ready-error" role="alert">{error}</p>}
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
