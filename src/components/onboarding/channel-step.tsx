"use client";
import { useState, useTransition } from "react";
import { Icon } from "@/components/dashboard/icon";
import { launchBusiness } from "@/lib/setup/actions";
import type { Readiness } from "@/lib/setup/readiness";

/** Onboarding step 3: the channel the agent answers on, then switching the
 * automatic replies on. Both can wait ("Më vonë"); the panel keeps reminding. */
export function ChannelStep({ slug, businessId, readiness, justConnected }: { slug: string; businessId: string; readiness: Readiness | null; justConnected: boolean }) {
  const home = `/b/${encodeURIComponent(slug)}`;
  const [live, setLive] = useState(readiness?.live ?? false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ig = readiness?.channel.instagram ?? null;
  const wa = readiness?.channel.whatsapp ?? false;
  const connected = ig !== null || wa;

  function activate() {
    setError("");
    const data = new FormData();
    data.set("mode", "automatic");
    start(async () => {
      const result = await launchBusiness(slug, data).catch(() => ({ error: "Aktivizimi nuk u krye. Provo përsëri." }));
      if (result && "error" in result && result.error) setError(result.error);
      else setLive(true);
    });
  }

  return (
    <>
      <div className="onboarding-progress">
        <progress max={3} value={3} aria-label="Progresi i konfigurimit" />
        <span>Hapi 3 nga 3</span>
      </div>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">KANALI I BISEDAVE</span>
        <h1>{live ? "Agjenti është gati" : connected ? "Kanali u lidh" : "Ku të përgjigjet Agjenti?"}</h1>
        <p>
          {live ? "Agjenti tani u përgjigjet klientëve vetë. Mund ta fikësh kurdo te Kanalet ose te Cilësimet."
            : connected ? "Mbetet vetëm të vendosësh nëse Agjenti u përgjigjet klientëve vetë."
            : "Lidh Instagram-in ose WhatsApp Business që Agjenti të marrë dhe t'u përgjigjet mesazheve të klientëve."}
        </p>
      </div>
      {justConnected && !live && <p className="onboarding-success" role="status">✓ Instagram-i u lidh.</p>}

      <div className="onboarding-found">
        <article className="onboarding-found-card">
          <span className="onboarding-found-icon is-instagram"><Icon name="instagram" size={20} /></span>
          <div className="onboarding-channel-body">
            <h2>Instagram</h2>
            <p className="onboarding-found-meta">{ig !== null ? `✓ I lidhur${ig ? ` · @${ig}` : ""}` : "Mesazhet direkte (DM) të llogarisë së biznesit."}</p>
          </div>
          {ig === null && <a className="onboarding-next onboarding-channel-button" href={`/api/instagram/oauth/start?businessId=${encodeURIComponent(businessId)}&return=onboarding`}>Lidh</a>}
        </article>
        <article className="onboarding-found-card">
          <span className="onboarding-found-icon is-whatsapp"><Icon name="whatsapp" size={20} /></span>
          <div className="onboarding-channel-body">
            <h2>WhatsApp Business</h2>
            <p className="onboarding-found-meta">{wa ? "✓ I lidhur" : "Lidhet te Kanalet me llogarinë tënde të Meta-s."}</p>
          </div>
          {!wa && <a className="onboarding-back onboarding-channel-button" href={`${home}/integrations`}>Lidh te Kanalet</a>}
        </article>

        {connected && !live && (
          <div className="onboarding-found-question">
            <p><strong>Të aktivizojmë përgjigjet automatike?</strong> Agjenti do t&apos;u përgjigjet klientëve vetë, me njohuritë dhe udhëzimet që ke vendosur.</p>
            {readiness && !readiness.tested && (
              <p className="onboarding-hint">Rekomandim: provoje një herë Agjentin para se t&apos;u përgjigjet klientëve. <a href={`${home}/agents/test`}>Provo Agjentin</a></p>
            )}
            {readiness?.blocked && <p className="onboarding-hint">Ende mungon: {readiness.blocked}</p>}
          </div>
        )}
        {error && <p className="onboarding-error" role="alert">{error}</p>}

        <div className="onboarding-actions">
          <span />
          <div className="onboarding-actions-end">
            {!live && <a className="onboarding-skip" href={home}>{connected ? "Jo ende" : "Më vonë"}</a>}
            {connected && !live
              ? <button type="button" className="onboarding-next" disabled={pending || !!readiness?.blocked} onClick={activate}>{pending ? "Duke aktivizuar…" : "Po, aktivizo"}</button>
              : live ? <a className="onboarding-next" href={home}>Vazhdo te paneli</a> : null}
          </div>
        </div>
      </div>
    </>
  );
}
