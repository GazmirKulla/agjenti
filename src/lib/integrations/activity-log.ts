export type IntegrationLogRow = { id: string; target: string; status: string; error: string | null; created_at: string };
export type IntegrationLogEntry = { id: string; label: string; ok: boolean; error: string | null; count: number; latest: string; earliest: string };

const labels: Record<string, [ok: string, failed: string]> = {
  orders: ["Porosia u dërgua në faqe", "Porosia nuk u dërgua në faqe"],
  order_status: ["Statusi i porosisë u përditësua", "Statusi i porosisë nuk u lexua"],
  order_files: ["Skedarët e porosisë u dërguan", "Skedarët e porosisë nuk u dërguan"],
  order_change: ["Ndryshimi i porosisë u dërgua", "Ndryshimi i porosisë nuk u dërgua"],
};

/** Presentation only: names a logged integration call; it never retries or judges delivery. */
export function describeIntegrationLog(log: Pick<IntegrationLogRow, "target" | "status">) {
  const ok = log.status === "ok";
  const known = labels[log.target];
  return { ok, label: known ? known[ok ? 0 : 1] : `${log.target} · ${log.status}` };
}

/** Collapses consecutive identical outcomes (newest first) into one row with a count. */
export function groupIntegrationLogs(logs: IntegrationLogRow[]): IntegrationLogEntry[] {
  const entries: IntegrationLogEntry[] = [];
  for (const log of logs) {
    const { label, ok } = describeIntegrationLog(log);
    const last = entries.at(-1);
    if (last && last.label === label && last.error === log.error) { last.count++; last.earliest = log.created_at; continue; }
    entries.push({ id: log.id, label, ok, error: log.error, count: 1, latest: log.created_at, earliest: log.created_at });
  }
  return entries;
}

/** "24 nën, 09:12 – 14:32" within one day; both dates otherwise. */
export function formatActivityRange(from: string, to: string, locale = "sq-AL") {
  if (from === to) return formatActivityTime(to, locale);
  const day = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane" }).format(new Date(value));
  const end = day(from) === day(to)
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Tirane" }).format(new Date(to))
    : formatActivityTime(to, locale);
  return `${formatActivityTime(from, locale)} – ${end}`;
}

export function formatActivityTime(value: string, locale = "sq-AL") {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Tirane" }).format(new Date(value));
}
