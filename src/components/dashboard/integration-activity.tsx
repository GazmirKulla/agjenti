"use client";
import { useDashboardTranslator } from "@/components/dashboard/language";
export type IntegrationActivityLog = {
  id: string;
  target: string;
  status: string;
  error: string | null;
  created_at: string;
};

/** Shared with Inbox: the same existing integration activity, not a new event system. */
export function IntegrationActivity({ logs }: { logs: IntegrationActivityLog[] }) {
  const t = useDashboardTranslator();
  return logs.length ? logs.map(log => <p key={log.id}>{log.target} · {log.status}{log.error ? ` · ${log.error}` : ""}</p>) : <p>{t("Ende nuk ka aktivitet.")}</p>;
}
