"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDashboardLanguage, useDashboardTranslator } from "@/components/dashboard/language";
import { Icon } from "@/components/dashboard/icon";
import { briefingPeriods, briefingSummary, metricLabels, periodLabels, type Briefing, type BriefingPeriod, type MetricId } from "@/lib/business-assistant/briefing-model";
import "./daily-briefing.css";

/** Presentation-local data only: no conversation creation or shared chat-state changes. */
export function DailyBriefing({ slug, active }: { slug: string; active: boolean }) {
  const t = useDashboardTranslator(), language = useDashboardLanguage();
  const [period, setPeriod] = useState<BriefingPeriod>("today");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loaded = useRef("");
  useEffect(() => {
    if (!active) return;
    const key = `${slug}:${period}:${refresh}`;
    if (loaded.current === key) return;
    const controller = new AbortController();
    setLoading(true); setError(false); setData(null);
    void fetch(`/api/business-assistant/briefing?slug=${encodeURIComponent(slug)}&period=${period}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    }).then(async response => {
      if (!response.ok) throw Error("unavailable");
      const value: Briefing = await response.json();
      if (!controller.signal.aborted) { setData(value); loaded.current = key; }
    }).catch(() => {
      if (!controller.signal.aborted) { setError(true); loaded.current = key; }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [active, slug, period, refresh]);
  const attention = data ? [
    { label: "Biseda aktualisht të kaluara te stafi", reading: data.attention.handoffs },
    { label: "Dështime integrimi të regjistruara", reading: data.attention.integrationFailures },
  ].filter(item => item.reading.status === "unavailable" || (item.reading.count ?? 0) > 0) : [];
  return <section className="daily-briefing" hidden={!active} aria-label={t("Përmbledhja e biznesit")} aria-busy={loading}>
    <header>
      <div><span className="briefing-eyebrow"><Icon name="spark" size={15} />{t("Biznesi yt, shkurt")}</span>
        <h2>{t("Përmbledhja e biznesit")}</h2></div>
      <button type="button" className="btn btn-secondary briefing-refresh" onClick={() => setRefresh(n => n + 1)}
        disabled={loading} aria-label={t("Rifresko përmbledhjen")}><Icon name="refresh" size={15} /><span>{t("Rifresko")}</span></button>
    </header>
    <div className="briefing-periods" role="group" aria-label={t("Periudha e raportimit")}>
      {briefingPeriods.map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{t(periodLabels[value])}</button>)}
    </div>
    {loading && <p role="status">{t("Po lexohen të dhënat e biznesit…")}</p>}
    {error && <p role="alert">{t("Nuk disponohet për momentin")}. {t("Provo ta rifreskosh përmbledhjen.")}</p>}
    {data && <>
      {data.range && <p className="briefing-range">{data.businessName} · {data.range.startDate}{data.range.endDate !== data.range.startDate ? ` – ${data.range.endDate}` : ""} · {data.timezone}</p>}
      <p className="briefing-summary" role="status">{briefingSummary(data, language)}</p>
      <dl className="briefing-metrics">
        {(Object.keys(data.metrics) as MetricId[]).filter(id => data.metrics[id].status !== "disabled").map(id => {
          const m = data.metrics[id];
          return <div key={id}><dt><Link href={m.href}>{t(metricLabels[id])}<span aria-hidden="true"> ↗</span></Link></dt>
            <dd className={m.status !== "available" ? "is-unavailable" : ""}>{m.status === "available" ? m.count : t("Nuk disponohet për momentin")}</dd></div>;
        })}
      </dl>
      {!!attention.length && <ul className="briefing-attention">{attention.map(({ label, reading }) =>
        <li key={label}><Link href={reading.href}>{t(label)}: {reading.status === "available" ? reading.count : t("Nuk disponohet për momentin")} <span aria-hidden="true">→</span></Link></li>
      )}</ul>}
      <details className="briefing-definitions"><summary>{t("Çfarë përfshin kjo pamje?")}</summary>
        <p>{t("Numërohen regjistrimet sipas kohës së ruajtjes, deri në kontrollin e fundit. Porositë përfshijnë të gjitha statuset; rezervimet sipas krijimit, jo datës së takimit.")}</p>
        <p>{t("Handoff-et janë gjendja aktuale, jo provë se klienti ende pret. Dështimet janë vetëm ato të regjistruara në log-et e integrimeve, jo monitorim i plotë i platformës.")}</p>
        <p>{t("Modulet joaktive nuk shfaqen. Leads, të ardhurat dhe trendet nuk përfshihen.")}</p>
      </details>
      <p className="briefing-freshness">{t("Kontrolluar në")} <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString(language === "en" ? "en-GB" : "sq-AL", {
        ...(data.range ? { timeZone: data.timezone } : {}), hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
      })}</time>{data.range ? ` · ${data.timezone}` : ""} · {t("Rifreskim manual")}</p>
    </>}
  </section>;
}
