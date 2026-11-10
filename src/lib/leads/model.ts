export type LeadStatus = "new" | "contacted" | "won" | "lost";
export type LeadSource = "price" | "availability" | "contact" | "keyword" | "agent" | "manual";
export type Lead = {
  id: string; status: LeadStatus; source: LeadSource; interest: string; note: string;
  last_interest_at: string; status_changed_at: string | null; created_at: string;
  conversation_id: string | null; customer: { id: string; display_name: string | null; username: string | null; phone: string | null } | null;
  channel: string | null;
  /** The conversation's own participant name, for leads without a CRM customer. */
  participant: string | null;
};

/** Owner-adjustable rules. Every rule is on unless turned off. */
export type LeadSettings = {
  enabled: boolean; price: boolean; availability: boolean; contact: boolean;
  autoContacted: boolean; keywords: string[]; followUpHours: number;
};
export const defaultLeadSettings: LeadSettings = {
  enabled: true, price: true, availability: true, contact: true, autoContacted: true, keywords: [], followUpHours: 4,
};
export const FOLLOW_UP_CHOICES = [1, 2, 4, 8, 24] as const;

export function leadSettings(raw: unknown): LeadSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flag = (key: keyof LeadSettings) => (typeof value[key] === "boolean" ? (value[key] as boolean) : (defaultLeadSettings[key] as boolean));
  const hours = Number(value.followUpHours);
  return {
    enabled: flag("enabled"), price: flag("price"), availability: flag("availability"), contact: flag("contact"),
    autoContacted: flag("autoContacted"),
    keywords: Array.isArray(value.keywords) ? cleanKeywords(value.keywords.filter((k): k is string => typeof k === "string").join(",")) : [],
    followUpHours: (FOLLOW_UP_CHOICES as readonly number[]).includes(hours) ? hours : defaultLeadSettings.followUpHours,
  };
}

/** "porosi me shumicë, katalog" → ["porosi me shumicë", "katalog"]; at most 20, 2–40 characters each. */
export function cleanKeywords(text: string) {
  const seen = new Set<string>();
  return text.split(/[,\n]/).map((k) => k.trim().replace(/\s+/g, " ")).filter((k) => {
    const key = k.toLowerCase();
    if (k.length < 2 || k.length > 40 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export const statusLabels: Record<LeadStatus, string> = { new: "I ri", contacted: "Në kontakt", won: "U bë klient", lost: "Humbur" };
export const sourceLabels: Record<LeadSource, string> = {
  price: "Pyeti për çmimin", availability: "Pyeti për disponueshmërinë", contact: "Kërkoi të kontaktohet",
  keyword: "Fjalë kyçe", agent: "Agjenti", manual: "Shtuar me dorë",
};

export const LEAD_VIEWS = ["open", "waiting", "won", "lost"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export const viewLabels: Record<LeadView, string> = { open: "Të hapura", waiting: "Presin përgjigje", won: "U bënë klientë", lost: "Humbur" };
export function leadView(value: string | undefined): LeadView {
  return (LEAD_VIEWS as readonly string[]).includes(value ?? "") ? (value as LeadView) : "open";
}

/** A new lead nobody has answered for longer than the owner's follow-up time. */
export function isWaiting(lead: Pick<Lead, "status" | "last_interest_at">, hours: number, now = Date.now()) {
  return lead.status === "new" && now - Date.parse(lead.last_interest_at) >= hours * 3_600_000;
}

export function leadName(lead: Pick<Lead, "customer"> & { participant?: string | null }) {
  const c = lead.customer;
  return c?.display_name || (c?.username ? `@${c.username}` : null) || lead.participant || c?.phone || "Klient pa emër";
}
