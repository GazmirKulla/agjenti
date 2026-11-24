"use client";
import { useDashboardLanguage, useDashboardTranslator } from "@/components/dashboard/language";
import "./activity.css";
import { formatActivityTime, groupIntegrationLogs, type IntegrationLogRow } from "@/lib/integrations/activity-log";
export type IntegrationActivityLog = IntegrationLogRow;

/** Shared with Inbox: the same existing integration activity, not a new event system. */
export function IntegrationActivity({ logs }: { logs: IntegrationActivityLog[] }) {
  const t = useDashboardTranslator();
  const locale = useDashboardLanguage() === "en" ? "en-GB" : "sq-AL";
  if (!logs.length) return <p>{t("Ende nuk ka aktivitet.")}</p>;
  return <ul className="activity-log">{groupIntegrationLogs(logs).map(entry => <li key={entry.id} className={entry.ok ? "" : "is-failed"}>
    <span className="activity-log-label">{entry.ok ? "✓" : "!"} {t(entry.label)}{entry.count > 1 ? ` ×${entry.count}` : ""}</span>
    <span className="activity-log-time">{entry.count > 1 && entry.earliest !== entry.latest
      ? `${formatActivityTime(entry.earliest, locale)} – ${formatActivityTime(entry.latest, locale)}`
      : formatActivityTime(entry.latest, locale)}</span>
    {entry.error && <span className="activity-log-error">{entry.error}</span>}
  </li>)}</ul>;
}
