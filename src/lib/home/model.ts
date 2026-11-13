import { zonedParts } from "@/lib/calendar/model";
import { dayBoundary, shiftDate } from "@/lib/business-assistant/briefing-model";

/** Kreu: the period the numbers cover. */
export const HOME_PERIODS = ["today", "7", "30"] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];
export const HOME_PERIOD_LABELS: Record<HomePeriod, string> = { today: "Sot", "7": "7 ditë", "30": "30 ditë" };
export const homePeriod = (value: unknown): HomePeriod => (HOME_PERIODS as readonly string[]).includes(String(value)) ? value as HomePeriod : "today";
export const periodDays = (period: HomePeriod) => (period === "today" ? 1 : Number(period));

/** From the start of the period's first day (in the business's time) to now,
 * plus today and tomorrow, for the bookings card. */
export function homeRange(period: HomePeriod, timezone: string, now: Date) {
  const today = zonedParts(now, timezone).date;
  return {
    from: dayBoundary(shiftDate(today, 1 - periodDays(period)), timezone),
    todayFrom: dayBoundary(today, timezone),
    tomorrowFrom: dayBoundary(shiftDate(today, 1), timezone),
    dayAfterFrom: dayBoundary(shiftDate(today, 2), timezone),
  };
}

export type HomeCard = {
  id: string; label: string; icon: string; href: string;
  /** The big number and what it counts. */
  value: number; caption: string;
  /** What was added in the period, or a second figure. */
  detail?: string; detailTone?: "up";
  /** At most one thing to act on. */
  attention?: { text: string; href: string; tone: "warning" | "danger" };
  /** Nothing recorded yet: what the module is for and the first step. */
  empty?: { text: string; actions: { label: string; href: string }[] };
};

/** A module that is not highlighted: listed under "all modules". */
export type HomeModuleLink = { id: string; label: string; description: string; icon: string; href: string; requires: string[] };

export type HomeMessages = { inbound: number; agentReplies: number; handoffs: number; days: { day: string; value: number }[] };

/** "+3 të reja" only when something was added. */
export const added = (count: number, noun: string) => (count > 0 ? `+${count} ${noun}` : undefined);

/** Totals by currency, the largest first: "184 €", or "184 € · 20 USD". */
export function money(rows: { total_amount: number | string | null; currency: string | null }[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = (row.currency || "EUR").toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  const symbol = (currency: string) => (currency === "EUR" ? "€" : currency === "ALL" ? "Lekë" : currency);
  return [...totals].sort((a, b) => b[1] - a[1])
    .map(([currency, total]) => `${Math.round(total).toLocaleString("sq-AL")} ${symbol(currency)}`).join(" · ");
}
