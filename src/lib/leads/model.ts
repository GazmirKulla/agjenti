/**
 * A lead is a state of the conversation (conversations.lead_status): the customer agent marks it when the
 * customer shows buying interest, an order or booking marks it won and a staff reply marks it contacted.
 */
export type LeadStatus = "new" | "contacted" | "won" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "won", "lost"];
export const statusLabels: Record<LeadStatus, string> = { new: "I ri", contacted: "Në kontakt", won: "U bë klient", lost: "Humbur" };

/** Bisedat filtered by lead: open (new or contacted), waiting (new and unanswered past the follow-up time), won, lost. */
export const LEAD_FILTERS = ["open", "waiting", "won", "lost"] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];
export const leadFilterLabels: Record<LeadFilter, string> = { open: "Të interesuar", waiting: "Interesuar, pa përgjigje", won: "U bënë klientë", lost: "Humbur" };
export function leadFilter(value: unknown): LeadFilter | null {
  return typeof value === "string" && (LEAD_FILTERS as readonly string[]).includes(value) ? value as LeadFilter : null;
}

/** The owner's follow-up time: a new lead unanswered for longer counts as waiting. */
export const DEFAULT_FOLLOW_UP_HOURS = 4;
export function followUpHours(settings: unknown): number {
  const hours = Number(settings && typeof settings === "object" ? (settings as Record<string, unknown>).followUpHours : NaN);
  return [1, 2, 4, 8, 24].includes(hours) ? hours : DEFAULT_FOLLOW_UP_HOURS;
}
