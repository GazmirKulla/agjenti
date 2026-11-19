import { createServiceSupabase } from "@/lib/supabase/service";
import { capabilities, type AgentKind, type Outcome } from "./capabilities";

export type HealthRow = { capability: string; point: string; outcome: Outcome | "entry"; reason: string | null; events: number; businesses: number; examples: string[] };
export type CapabilityHealth = {
  capability: string; agent: AgentKind; module: string; label: string;
  entries: number; success: number; failure: number; handoff: number; neutral: number; abandoned: number;
  /** success / (success + failure), null without either. */
  rate: number | null; previousRate: number | null;
  reasons: { point: string; reason: string | null; events: number; examples: { businessId: string; conversationId: string }[] }[];
  lastAt: string | null;
};

const empty = (capability: string): CapabilityHealth => {
  const spec = capabilities[capability];
  return { capability, agent: spec?.agent ?? "customer", module: spec?.module ?? "?", label: spec?.label ?? capability,
    entries: 0, success: 0, failure: 0, handoff: 0, neutral: 0, abandoned: 0, rate: null, previousRate: null, reasons: [], lastAt: null };
};
const rate = (success: number, failure: number) => success + failure ? success / (success + failure) : null;

/** Pure: one summary per capability from the grouped rows of this period and the previous one. */
export function summarizeHealth(current: HealthRow[], previous: HealthRow[], lastSeen: Record<string, string>): CapabilityHealth[] {
  const byCapability = new Map<string, CapabilityHealth>();
  const get = (capability: string) => byCapability.get(capability) ?? byCapability.set(capability, empty(capability)).get(capability)!;
  for (const row of current) {
    const item = get(row.capability);
    if (row.outcome === "entry") item.entries += row.events;
    else item[row.outcome] += row.events;
    if (row.point === "abandoned") item.abandoned += row.events;
    if (row.outcome === "failure" || row.outcome === "handoff") item.reasons.push({ point: row.point, reason: row.reason, events: row.events,
      examples: row.examples.flatMap(example => { const [businessId, conversationId] = example.split(":"); return businessId && conversationId ? [{ businessId, conversationId }] : []; }) });
  }
  const before = new Map<string, { success: number; failure: number }>();
  for (const row of previous) if (row.outcome === "success" || row.outcome === "failure") {
    const item = before.get(row.capability) ?? { success: 0, failure: 0 };
    item[row.outcome] += row.events; before.set(row.capability, item);
  }
  for (const item of byCapability.values()) {
    item.rate = rate(item.success, item.failure);
    const prior = before.get(item.capability);
    item.previousRate = prior ? rate(prior.success, prior.failure) : null;
    item.reasons.sort((a, b) => b.events - a.events);
    item.lastAt = lastSeen[item.capability] ?? null;
  }
  return [...byCapability.values()];
}

/** The capabilities that recorded nothing in the period, with when they were last seen (null: never). */
export function silentCapabilities(health: CapabilityHealth[], lastSeen: Record<string, string>) {
  const active = new Set(health.map(item => item.capability));
  return Object.entries(capabilities).filter(([id]) => !active.has(id))
    .map(([id, spec]) => ({ capability: id, agent: spec.agent, module: spec.module, label: spec.label, lastAt: lastSeen[id] ?? null }));
}

/** Declared capabilities with no source that emits them: they exist but are not tracked. */
export function untrackedCapabilities() {
  return Object.entries(capabilities).filter(([, spec]) => !spec.emittedBy.length).map(([id, spec]) => ({ capability: id, label: spec.label, agent: spec.agent }));
}

const rows = (data: unknown): HealthRow[] => (Array.isArray(data) ? data : []).map(row => ({ ...row, events: Number(row.events), businesses: Number(row.businesses), examples: row.examples ?? [] }));

/** Platform Admin: the period's health, the previous period's for comparison, days, and silent capabilities. */
export async function loadCapabilityHealth(days: number, businessId: string | null, now = new Date()) {
  const db = createServiceSupabase();
  const to = now.toISOString(), from = new Date(now.getTime() - days * 86400000).toISOString(), before = new Date(now.getTime() - 2 * days * 86400000).toISOString();
  const [current, previous, daily, last] = await Promise.all([
    db.rpc("capability_health", { p_from: from, p_to: to, p_business: businessId }),
    db.rpc("capability_health", { p_from: before, p_to: from, p_business: businessId }),
    db.rpc("capability_daily", { p_from: from, p_to: to, p_business: businessId }),
    db.rpc("capability_last_seen", { p_business: businessId }),
  ]);
  if (current.error || previous.error || daily.error || last.error) return { available: false as const };
  const lastSeen: Record<string, string> = Object.fromEntries((last.data ?? []).map((row: { capability: string; last_at: string }) => [row.capability, row.last_at]));
  const health = summarizeHealth(rows(current.data), rows(previous.data), lastSeen);
  return { available: true as const, health, silent: silentCapabilities(health, lastSeen), untracked: untrackedCapabilities(),
    daily: (daily.data ?? []).map((row: { day: string; agent: AgentKind; outcome: Outcome | "entry"; events: number }) => ({ ...row, events: Number(row.events) })) as { day: string; agent: AgentKind; outcome: Outcome | "entry"; events: number }[] };
}
