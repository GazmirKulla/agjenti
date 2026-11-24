"use client";
import { useDashboardLanguage, useDashboardTranslator } from "@/components/dashboard/language";
import "./activity.css";
import { formatActivityRange, groupIntegrationLogs, type IntegrationLogRow } from "@/lib/integrations/activity-log";
export type IntegrationActivityLog = IntegrationLogRow;

/** Shared with Inbox: the same existing integration activity, not a new event system. */
export function IntegrationActivity({ logs }: { logs: IntegrationActivityLog[] }) {
  const t = useDashboardTranslator();
  const locale = useDashboardLanguage() === "en" ? "en-GB" : "sq-AL";
  if (!logs.length) return <p>{t("Ende nuk ka aktivitet.")}</p>;
  const entries = groupIntegrationLogs(logs);
  const succeeded = entries.filter(entry => entry.ok).reduce((sum, entry) => sum + entry.count, 0);
  const failed = logs.length - succeeded;
  return <>
    <div className="activity-summary">
      <span className="activity-pill is-success">✓ {succeeded} {t("u kryen")}</span>
      {failed > 0 && <span className="activity-pill is-danger">! {failed} {t("dështuan")}</span>}
    </div>
    <ul className="activity-log">{entries.map(entry => {
      const tone = entry.ok ? "success" : "danger";
      return <li key={entry.id} className={`is-${tone}`}>
        <span className={`activity-icon is-${tone}`} aria-hidden="true">{entry.ok ? "✓" : "!"}</span>
        <span className="activity-log-body">
          <span className="activity-log-label">{t(entry.label)}{entry.count > 1 && <span className="activity-count">×{entry.count}</span>}</span>
          <span className="activity-log-time">{formatActivityRange(entry.earliest, entry.latest, locale)}</span>
          {entry.error && <span className="activity-log-error">{t("Arsyeja")}: <code>{entry.error}</code></span>}
        </span>
        <span className={`activity-pill is-${tone}`}>{t(entry.ok ? "U krye" : "Dështoi")}</span>
      </li>;
    })}</ul>
  </>;
}
