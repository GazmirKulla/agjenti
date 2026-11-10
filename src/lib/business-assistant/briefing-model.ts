import { zonedParts } from "@/lib/calendar/model";
import { translator, type DashboardLanguage } from "@/lib/dashboard/language/core";

export const briefingPeriods = ["today", "yesterday", "week"] as const;
export type BriefingPeriod = typeof briefingPeriods[number];
export type MetricId = "messages" | "orders" | "customers" | "bookings";
export type Reading = {
  status: "available" | "unavailable" | "disabled";
  count: number | null;
  reason?: "query_failed" | "permission_unavailable" | "timezone_invalid" | "module_off";
  checkedAt: string;
  href: string;
};
export type Briefing = {
  businessId: string;
  businessName: string;
  timezone: string;
  generatedAt: string;
  recordedBefore: string | null;
  period: BriefingPeriod;
  range: { from: string; to: string; startDate: string; endDate: string } | null;
  configurationError?: "timezone_invalid";
  metrics: Record<MetricId, Reading>;
  attention: { handoffs: Reading; integrationFailures: Reading; waitingLeads?: Reading };
  unavailableMetrics: MetricId[];
};
export const metricLabels: Record<MetricId, string> = {
  messages: "Mesazhe hyrëse", orders: "Porosi të krijuara",
  customers: "Klientë të rinj CRM", bookings: "Rezervime të krijuara",
};
export const periodLabels: Record<BriefingPeriod, string> = {
  today: "Sot", yesterday: "Dje", week: "Kjo javë",
};
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** First real instant of a local date, including midnight DST transitions.
 * Calendar dates are advanced before conversion; a day is not assumed to be 24h. */
function dayBoundary(date: string, timezone: string) {
  const naive = Date.parse(`${date}T00:00:00Z`);
  let low = naive - 36 * 3600000, high = naive + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (zonedParts(new Date(middle), timezone).date < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low).toISOString();
}
export function reportingRange(period: BriefingPeriod, timezone: string, now: Date) {
  if (!timezone.trim() || !Number.isFinite(now.getTime())) throw Error("timezone_invalid");
  const today = zonedParts(now, timezone).date;
  const startDate = period === "yesterday" ? shiftDate(today, -1)
    : period === "week" ? shiftDate(today, -((new Date(`${today}T12:00Z`).getUTCDay() + 6) % 7))
    : today;
  const endDate = period === "yesterday" ? startDate : today;
  const from = dayBoundary(startDate, timezone), to = dayBoundary(shiftDate(endDate, 1), timezone);
  if (to <= from) throw Error("timezone_invalid");
  return { from, to, startDate, endDate };
}


export function briefingSummary(data: Briefing, language: DashboardLanguage) {
  const t = translator(language);
  if (data.configurationError) return t("Zona kohore e biznesit është e pavlefshme. Përmbledhja nuk disponohet.");
  const available = Object.values(data.metrics).filter(m => m.status === "available");
  if (!available.length) return t("Të dhënat nuk disponohen për momentin.");
  if (data.unavailableMetrics.length) return t("Kjo është një pamje e pjesshme; disa të dhëna nuk disponohen.");
  return available.every(m => m.count === 0)
    ? t("Nuk ka aktivitet të regjistruar në modulet e shfaqura për këtë periudhë.")
    : t("Ja aktiviteti i regjistruar në biznesin tënd.");
}
/** Numeric statements are rendered from verified counts, never model-authored text. */
export function briefingAnswer(data: Briefing, language: DashboardLanguage) {
  const t = translator(language);
  const range = data.range ? `${data.range.startDate} – ${data.range.endDate} · ${data.timezone}` : "";
  const metrics = (Object.keys(data.metrics) as MetricId[]).map(id => {
    const m = data.metrics[id];
    return `${t(metricLabels[id])}: ${m.status === "available" ? m.count : t(m.status === "disabled" ? "Moduli nuk është aktiv ose i autorizuar." : "Nuk disponohet për momentin")}`;
  });
  const attention = [
    ["Biseda aktualisht të kaluara te stafi", data.attention.handoffs],
    ["Dështime integrimi të regjistruara", data.attention.integrationFailures],
    ...(data.attention.waitingLeads ? [["Leads që presin përgjigje", data.attention.waitingLeads] as const] : []),
  ] as const;
  return [t(periodLabels[data.period]), range, briefingSummary(data, language), ...metrics,
    ...attention.filter(([, m]) => m.status !== "disabled").map(([label, m]) => `${t(label)}: ${m.status === "available" ? m.count : t("Nuk disponohet për momentin")}`),
    t("Numërohen regjistrimet e ruajtura, jo të ardhurat apo personat unikë."),
    `${t("Kontrolluar në")}: ${data.generatedAt}`,
  ].filter(Boolean).join("\n");
}
