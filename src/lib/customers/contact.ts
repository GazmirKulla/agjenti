/**
 * One answer to "what are this person's contact details", shared by the web
 * Inbox, the native app and the forms' prefill. The saved customer, the last
 * order's delivery and the agent's memory each hold a copy; this picks one per
 * field by a fixed rule and keeps the others visible instead of hiding them.
 *
 * Rule: the most recently written value wins. A value without a known time
 * (the agent's in-conversation copy) only fills an empty field. On equal times
 * an order beats the customer record, which beats the agent's memory.
 */
export const CONTACT_KEYS = ["name", "phone", "email", "city", "address"] as const;
export type ContactKey = (typeof CONTACT_KEYS)[number];
/** crm: the saved customer · order: the delivery of the latest order · agent: what the agent collected. */
export type ContactSource = "crm" | "order" | "agent";
export type ContactCandidate = { value: string; source: ContactSource; at: string | null };
export type ContactValue = ContactCandidate & {
  /** Other sources that hold a different value for this field, newest first. */
  others: ContactCandidate[];
};
export type ResolvedContact = Record<ContactKey, ContactValue | null>;

type Values = Partial<Record<ContactKey, string | null | undefined>>;
export type ContactInputs = {
  crm?: { values: Values; at: string | null } | null;
  order?: { values: Values; at: string | null } | null;
  agent?: { values: Values; at: string | null } | null;
};

const RANK: Record<ContactSource, number> = { order: 0, crm: 1, agent: 2 };

/** Formats only: phones compare by digits, text ignores spacing and case. */
function sameValue(key: ContactKey, a: string, b: string) {
  if (key === "phone") return a.replace(/\D/g, "") === b.replace(/\D/g, "");
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return norm(a) === norm(b);
}

function time(at: string | null) {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

export function resolveContact(inputs: ContactInputs): ResolvedContact {
  const result = {} as ResolvedContact;
  for (const key of CONTACT_KEYS) {
    const candidates: ContactCandidate[] = [];
    for (const source of ["order", "crm", "agent"] as const) {
      const entry = inputs[source];
      const value = entry?.values[key]?.trim();
      if (value) candidates.push({ value, source, at: entry?.at ?? null });
    }
    candidates.sort((a, b) => {
      const ta = time(a.at), tb = time(b.at);
      if (ta !== null && tb !== null && ta !== tb) return tb - ta;
      if (ta === null && tb !== null) return 1;
      if (tb === null && ta !== null) return -1;
      return RANK[a.source] - RANK[b.source];
    });
    const [chosen, ...rest] = candidates;
    if (!chosen) {
      result[key] = null;
      continue;
    }
    const others: ContactCandidate[] = [];
    for (const candidate of rest)
      if (!sameValue(key, candidate.value, chosen.value) && !others.some((o) => sameValue(key, o.value, candidate.value)))
        others.push(candidate);
    result[key] = { ...chosen, others };
  }
  return result;
}

/** The delivery details an order was saved with (manual and agent orders store the same shape). */
export function orderDelivery(payload: unknown): Values | null {
  const customer = payload && typeof payload === "object" ? (payload as { customer?: unknown }).customer : null;
  if (!customer || typeof customer !== "object") return null;
  const raw = customer as Record<string, unknown>;
  const pick = (k: string) => (typeof raw[k] === "string" && (raw[k] as string).trim() ? (raw[k] as string).trim().slice(0, 300) : null);
  const values = { name: pick("name"), phone: pick("phone"), city: pick("city"), address: pick("address") };
  return Object.values(values).some(Boolean) ? values : null;
}

export const contactSourceLabels: Record<ContactSource, string> = {
  crm: "Kartela e klientit",
  order: "Porosia e fundit",
  agent: "Mbledhur nga agjenti",
};
