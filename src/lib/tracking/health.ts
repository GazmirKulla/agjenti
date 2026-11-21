import { createServiceSupabase } from "@/lib/supabase/service";
import { capabilities, type AgentKind, type Outcome } from "./capabilities";

export type HealthRow = { capability: string; point: string; outcome: Outcome | "entry"; reason: string | null; events: number; businesses: number; examples: string[] };
export type CapabilityHealth = {
  capability: string; agent: AgentKind; module: string; label: string;
  entries: number; success: number; failure: number; handoff: number; neutral: number; abandoned: number;
  /** success / (success + failure), null without either. */
  rate: number | null; previousRate: number | null;
  reasons: { point: string; outcome: Outcome; reason: string | null; events: number; examples: { businessId: string; conversationId: string }[] }[];
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
    // Neutral exits with a reason say why nothing happened (e.g. no reply: auto replies off).
    if (row.outcome === "failure" || row.outcome === "handoff" || row.outcome === "neutral" && row.reason) item.reasons.push({ point: row.point, outcome: row.outcome, reason: row.reason, events: row.events,
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
    // What went wrong first, then why nothing happened.
    item.reasons.sort((a, b) => Number(a.outcome === "neutral") - Number(b.outcome === "neutral") || b.events - a.events);
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

export type FailureEvent = { id: number; businessId: string | null; agent: AgentKind; capability: string; point: string; reason: string | null;
  conversationId: string | null; ref: string | null; durationMs: number | null; createdAt: string };
const failureColumns = "id,business_id,agent,capability,point,reason,conversation_id,ref,duration_ms,created_at";
const toFailure = (row: Record<string, unknown>): FailureEvent => ({ id: Number(row.id), businessId: (row.business_id as string | null) ?? null, agent: row.agent as AgentKind,
  capability: String(row.capability), point: String(row.point), reason: (row.reason as string | null) ?? null, conversationId: (row.conversation_id as string | null) ?? null,
  ref: (row.ref as string | null) ?? null, durationMs: row.duration_ms === null ? null : Number(row.duration_ms), createdAt: String(row.created_at) });

/** Platform Admin: the newest failures of the period, each one openable. */
export async function loadRecentFailures(days: number, businessId: string | null, limit = 25, now = new Date()) {
  let query = createServiceSupabase().from("capability_events").select(failureColumns).eq("mode", "live").eq("outcome", "failure")
    .gte("created_at", new Date(now.getTime() - days * 86400000).toISOString());
  if (businessId) query = query.eq("business_id", businessId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  return error ? [] : (data ?? []).map(toFailure);
}

const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export type AssistantTurn = { matched: "request" | "time"; messages: { role: string; kind: string; content: string; at: string }[] };

/**
 * One failure with what led to it: the other events of the same request, and for the Assistant the owner's
 * request and the reply it got. Events recorded since requests are linked carry the request id; older ones
 * are matched to the business's Assistant request just before the failure, and say so.
 */
export async function loadFailure(id: number) {
  const db = createServiceSupabase();
  const { data } = await db.from("capability_events").select(failureColumns).eq("id", id).maybeSingle();
  if (!data) return null;
  const event = toFailure(data);
  const trailQuery = event.ref ? db.from("capability_events").select(failureColumns).eq("ref", event.ref).eq("capability", event.capability) : null;
  const trail = trailQuery ? await (event.businessId ? trailQuery.eq("business_id", event.businessId) : trailQuery.is("business_id", null)).order("id").limit(50) : null;
  let turn: AssistantTurn | null = null;
  if (event.agent === "assistant" && event.businessId) {
    const read = (rows: unknown, matched: AssistantTurn["matched"]): AssistantTurn | null => Array.isArray(rows) && rows.length
      ? { matched, messages: rows.map(row => ({ role: row.role, kind: row.kind, content: String(row.content ?? "").slice(0, 4000), at: row.created_at })) } : null;
    if (isUuid(event.ref)) {
      const { data: rows } = await db.from("assistant_messages").select("role,kind,content,created_at,assistant_conversations!inner(business_id)")
        .eq("request_id", event.ref).eq("assistant_conversations.business_id", event.businessId).order("seq");
      turn = read(rows, "request");
    }
    if (!turn) {
      const at = Date.parse(event.createdAt);
      const { data: asked } = await db.from("assistant_messages").select("request_id,conversation_id,assistant_conversations!inner(business_id)")
        .eq("assistant_conversations.business_id", event.businessId).eq("role", "user")
        .gte("created_at", new Date(at - 120000).toISOString()).lte("created_at", new Date(at + 1000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (asked) {
        const { data: rows } = await db.from("assistant_messages").select("role,kind,content,created_at").eq("conversation_id", asked.conversation_id).eq("request_id", asked.request_id).order("seq");
        turn = read(rows, "time");
      }
    }
  }
  return { event, trail: (trail?.data ?? []).map(toFailure), turn };
}

type ConnectionRow = Record<string, string | number | null>;
/** Pure: a channel connection that needs someone, or null when it works. */
export function connectionAttention(name: "Instagram" | "WhatsApp", row: ConnectionRow): Attention | null {
  if (row.status === "connected" && !row.last_error) return null;
  const lastError = row.last_error === null ? null : String(row.last_error);
  // Meta rejected the token: the agent cannot read or answer until the owner reconnects.
  const rejected = /^token_rejected:/.test(lastError ?? "");
  return { kind: "connection",
    title: rejected ? `${name}: Meta e refuzoi token-in, duhet rilidhur` : `${name}: ${row.status === "connected" ? "i lidhur, por me gabim" : row.status}`,
    detail: (rejected ? `Agjenti nuk lexon dhe nuk u përgjigjet mesazheve. Pronari duhet të klikojë “Rilidh ${name}-in” te Integrimet. (${lastError})` : lastError ?? "Lidhja nuk është aktive.").slice(0, 300),
    businessId: String(row.business_id), since: row.updated_at as string | null, href: name === "Instagram" ? "instagram" : "whatsapp" };
}

export type Attention = { kind: "connection" | "stuck"; title: string; detail: string; businessId: string; since: string | null; href: string | null };
const STUCK_MS = 30 * 60000;
/**
 * What looks fine but does not work: channel connections that are "connected" with an error (or expired),
 * and background jobs waiting or running past their time. Read from the jobs' own tables, not from events.
 */
export async function loadAttention(businessId: string | null, now = Date.now()): Promise<Attention[]> {
  const db = createServiceSupabase();
  const late = new Date(now - STUCK_MS).toISOString();
  const read = async (table: string, columns: string, filter: (q: ReturnType<ReturnType<typeof db.from>["select"]>) => typeof q, limit: number) => {
    let query = filter(db.from(table).select(columns));
    if (businessId) query = query.eq("business_id", businessId);
    const { data } = await query.limit(limit);
    return (data ?? []) as unknown as Record<string, string | number | null>[];
  };
  const connection = "business_id,status,last_error,updated_at", job = "business_id,source,stage,status,attempts,next_attempt_at,leased_until,updated_at";
  const [instagram, whatsapp, discovery, training] = await Promise.all([
    read("instagram_connections", connection, q => q.neq("status", "disconnected"), 500),
    read("whatsapp_connections", connection, q => q.neq("status", "disconnected"), 500),
    read("business_discovery_jobs", job, q => q.in("status", ["queued", "running"]), 200),
    read("conversation_training_sessions", job, q => q.in("status", ["queued", "running"]), 200),
  ]);
  const out: Attention[] = [];
  for (const [name, rows] of [["Instagram", instagram], ["WhatsApp", whatsapp]] as const)
    for (const row of rows) { const item = connectionAttention(name, row); if (item) out.push(item); }
  const due = (row: Record<string, string | number | null>) => (row.status === "queued" ? row.next_attempt_at : row.leased_until) as string | null;
  for (const [label, rows] of [["Analiza e biznesit", discovery], ["Importi i bisedave", training]] as const)
    for (const row of rows) if (due(row) && due(row)! < late)
      out.push({ kind: "stuck", title: `${label} (${row.source}) ka ngecur`, detail: `${row.status === "queued" ? "Në radhë" : "Në punë"} te hapi “${row.stage}”, ${row.attempts} prova. Pritej të vazhdonte që nga ${new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" }).format(new Date(due(row)!))}.`,
        businessId: String(row.business_id), since: row.updated_at as string | null, href: null });
  return out;
}
