import { nameKey, PROFILE_LABELS, similarity, suggestionKey, type Candidate, type Price, type Suggestion } from "./analysis-model";

export type ExistingData = {
  products: { id: string; name: string; description: string | null; price_amount: number | null; price_max: number | null; price_mode: string | null; currency: string | null; price_unit: string | null }[];
  services: { id: string; name: string; description: string | null; price_amount: number | null; currency: string | null; price_mode: string | null }[];
  knowledge: { id: string; title: string; body: string }[];
  /** Opening hours set in the calendar, as the owner wrote them (or null). */
  calendarHours: unknown;
};

/** Merges candidates that are the same thing; `groups` (from the AI) may join different names and fix the kind. */
export function mergeCandidates(candidates: Candidate[], groups?: { ids: string[]; kind: Candidate["kind"]; name: string }[]): Candidate[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const sets: { members: Candidate[]; kind?: Candidate["kind"]; name?: string }[] = [];
  const used = new Set<string>();
  for (const group of groups ?? []) {
    const members = group.ids.map((id) => byId.get(id)).filter((c): c is Candidate => !!c && !used.has(c.id));
    if (!members.length) continue;
    members.forEach((m) => used.add(m.id));
    sets.push({ members, kind: group.kind, name: group.name });
  }
  // Whatever the AI did not group: same kind (or profile field) and same name.
  const rest = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (used.has(c.id)) continue;
    const key = `${c.kind}|${c.field ?? ""}|${c.kind === "profile" ? "" : nameKey(c.name)}`;
    rest.set(key, [...(rest.get(key) ?? []), c]);
  }
  for (const members of rest.values()) sets.push({ members });
  return sets.map(({ members, kind, name }) => {
    const rank = { high: 3, medium: 2, low: 1 } as const;
    const best = [...members].sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.body.length - a.body.length)[0];
    const owner = members.filter((m) => m.saidBy === "owner");
    const body = [...(owner.length ? owner : members)].sort((a, b) => b.body.length - a.body.length)[0].body;
    const prices = uniquePrices(members.flatMap((m) => m.prices));
    const evidence = members.flatMap((m) => m.evidence).filter((e, i, list) => list.findIndex((x) => x.thread === e.thread && x.quote === e.quote) === i)
      .sort((a, b) => (a.speaker === "customer" ? 1 : 0) - (b.speaker === "customer" ? 1 : 0) || b.at.localeCompare(a.at)).slice(0, 4);
    const finalKind = kind ?? best.kind;
    const count = new Set(members.flatMap((m) => m.evidence.map((e) => e.thread))).size;
    return {
      ...best, kind: finalKind, name: (name?.trim() || best.name).slice(0, 160), body, prices, evidence, count,
      field: finalKind === "profile" ? best.field ?? members.find((m) => m.field)?.field ?? null : null,
      explicit: members.some((m) => m.explicit),
      // Repeated across conversations by the owner: more certain.
      confidence: owner.length && count >= 3 ? "high" : best.confidence,
      saidBy: (owner.length ? "owner" : "agent") as Candidate["saidBy"],
    };
  }).filter((c) => c.kind !== "profile" || c.field);
}

function uniquePrices(prices: Price[]): Price[] {
  const out: Price[] = [];
  for (const p of [...prices].sort((a, b) => b.at.localeCompare(a.at))) {
    if (out.some((o) => o.min === p.min && o.max === p.max && o.currency === p.currency && (o.condition ?? "") === (p.condition ?? ""))) continue;
    out.push(p);
  }
  return out.slice(0, 6);
}

const DAY = 86_400_000;
const priceText = (p: { min: number; max: number | null; currency: string; unit?: string | null }) =>
  `${p.min}${p.max ? `–${p.max}` : ""} ${p.currency === "ALL" ? "lekë" : p.currency}${p.unit ? ` / ${p.unit}` : ""}`;
const samePrice = (a: Price, amount: number | null, max: number | null, currency: string | null) =>
  amount !== null && a.min === Number(amount) && (a.max ?? null) === (max === null ? null : Number(max)) && (!currency || a.currency === currency);

function best<T extends { name?: string; title?: string }>(rows: T[], name: string, threshold: number) {
  let top: { row: T; score: number } | null = null;
  for (const row of rows) {
    const score = similarity(name, row.name ?? row.title ?? "");
    if (score >= threshold && (!top || score > top.score)) top = { row, score };
  }
  return top?.row ?? null;
}

/** Turns merged candidates into suggestions for the review, each compared with what the business already has. */
export function suggestionsFor(businessId: string, candidates: Candidate[], existing: ExistingData, now = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (s: Omit<Suggestion, "content_key">) => out.push({ ...s, content_key: suggestionKey(businessId, s.destination, s.target_id, s.proposed) });
  for (const c of candidates) {
    const uncertain = c.confidence === "low" || !c.explicit || c.saidBy === "agent";
    const base = { evidence: c.evidence, confidence: c.confidence, explicit: c.explicit };
    if (c.kind === "product" || c.kind === "service") {
      const own = c.kind === "product" ? existing.products : existing.services;
      const other = c.kind === "product" ? existing.services : existing.products;
      const match = best(own, c.name, 0.75);
      const latest = c.prices[0] ?? null;
      const proposed = {
        name: c.name, description: c.body || null, category: c.category,
        price: latest ? { min: latest.min, max: latest.max, currency: latest.currency, unit: latest.unit, approximate: latest.approximate, condition: latest.condition, mentionedAt: latest.at, ageDays: Math.floor((now - Date.parse(latest.at)) / DAY) } : null,
        prices: c.prices.map((p) => ({ ...p, text: priceText(p) })),
      };
      const table = c.kind === "product" ? "products" : "booking_services";
      if (!match) {
        const elsewhere = best(other, c.name, 0.9);
        if (elsewhere) {
          push({ ...base, destination: c.kind, operation: "duplicate", target_table: c.kind === "product" ? "booking_services" : "products", target_id: elsewhere.id,
            title: c.name, current_value: { name: elsewhere.name, kind: c.kind === "product" ? "service" : "product" }, proposed, requires_confirmation: true, risk: "important" });
          continue;
        }
        push({ ...base, destination: c.kind, operation: "create", target_table: table, target_id: null, title: c.name, current_value: null, proposed,
          // A price from old conversations is never taken as current without the owner.
          requires_confirmation: !!latest || uncertain, risk: latest ? "important" : "safe" });
        continue;
      }
      const amount = match.price_amount === null ? null : Number(match.price_amount);
      const maxPrice = "price_max" in match ? (match.price_max === null ? null : Number(match.price_max)) : null;
      const current = { name: match.name, description: match.description, price: amount === null ? null : { min: amount, max: maxPrice, currency: match.currency, mode: match.price_mode } };
      const priceDiffers = latest && amount !== null && !samePrice(latest, amount, maxPrice, match.currency);
      const priceMissing = latest && amount === null;
      const describes = c.body && !match.description?.trim();
      const operation = priceDiffers ? "conflict" : priceMissing || describes ? "update" : "duplicate";
      push({ ...base, destination: c.kind, operation, target_table: table, target_id: match.id, title: c.name, current_value: current, proposed,
        requires_confirmation: !!(priceDiffers || priceMissing) || uncertain, risk: priceDiffers || priceMissing ? "important" : "safe" });
      continue;
    }
    if (c.kind === "profile" && c.field) {
      const label = PROFILE_LABELS[c.field];
      const entry = existing.knowledge.find((k) => nameKey(k.title) === nameKey(label)) ?? best(existing.knowledge, label, 0.8);
      const calendar = c.field === "hours" && existing.calendarHours ? existing.calendarHours : null;
      const same = entry && similarity(entry.body, c.body) >= 0.8;
      push({ ...base, destination: "profile", operation: same ? "duplicate" : entry || calendar ? "conflict" : "create",
        target_table: entry ? "knowledge_entries" : calendar ? "business_calendar_settings" : null, target_id: entry?.id ?? null,
        title: label, current_value: entry ? { title: entry.title, body: entry.body } : calendar ? { hours: calendar } : null,
        proposed: { field: c.field, title: label, body: c.body },
        requires_confirmation: c.field !== "description" || uncertain, risk: c.field === "description" ? "safe" : "important" });
      continue;
    }
    if (c.kind === "knowledge") {
      const entry = best(existing.knowledge, c.name, 0.7);
      const same = entry && similarity(entry.body, c.body) >= 0.7;
      const factual = /\d/.test(c.body);
      push({ ...base, destination: "knowledge", operation: same ? "duplicate" : entry ? "update" : "create",
        target_table: "knowledge_entries", target_id: entry?.id ?? null, title: c.name,
        current_value: entry ? { title: entry.title, body: entry.body } : null, proposed: { title: c.name, body: c.body },
        requires_confirmation: uncertain || factual, risk: factual || entry ? "important" : "safe" });
      continue;
    }
    if (c.kind === "workflow") {
      push({ ...base, destination: "workflow", operation: "create", target_table: null, target_id: null, title: c.name, current_value: null,
        proposed: { name: c.name, steps: c.body.split(/\n|(?<=\.)\s+(?=\d+[.)]|[A-ZË])/).map((s) => s.trim()).filter(Boolean).slice(0, 12) },
        requires_confirmation: true, risk: "important" });
      continue;
    }
    if (c.kind === "gap") {
      const answered = best(existing.knowledge, c.name, 0.75);
      if (answered) continue;
      push({ ...base, destination: "gap", operation: "create", target_table: null, target_id: null, title: c.name, current_value: null,
        proposed: { question: c.name, timesAsked: c.count }, requires_confirmation: false, risk: "safe" });
    }
  }
  return out;
}
