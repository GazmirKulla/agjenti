import { createServerSupabase } from "@/lib/supabase/server";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { parseDashboardProfile } from "@/lib/dashboard/profile/service";
import { legacyDashboardProfile } from "@/lib/dashboard/profile/legacy";
import { reportingRange, type Briefing, type BriefingPeriod, type MetricId, type Reading } from "./briefing-model";

export class BriefingError extends Error {
  constructor(public status: number) { super("Briefing unavailable"); }
}
const modules = ["inbox", "orders", "customers", "bookings"] as const;
type Permission = "allowed" | "disabled" | "unavailable";

/** No business writes or provider calls. All metric reads use the user's JWT/RLS.
 * Existing access resolution is reused for canonical and historical slugs. */
export async function loadBriefing(slug: string, period: BriefingPeriod, now = new Date()): Promise<Briefing> {
  const db = await createServerSupabase();
  const auth = await db.auth.getUser();
  if (auth.error || !auth.data.user) throw new BriefingError(401);
  const access = await requireBusinessAccess(auth.data.user.id, slug);
  if (!access) throw new BriefingError(403);
  const id = access.business.id;
  async function configuration() {
    const { data, error } = await db.from("businesses").select("id,name,slug,timezone,dashboard_profile").eq("id", id).maybeSingle();
    if (error) throw new BriefingError(503);
    // RLS rechecks live membership, independent of the access helper's request cache.
    if (!data) throw new BriefingError(403);
    return data;
  }
  const business = await configuration();
  const profile = parseDashboardProfile(business.dashboard_profile) ?? legacyDashboardProfile;
  const base = `/b/${encodeURIComponent(business.slug)}`;
  async function permissions(): Promise<Record<string, Permission>> {
    return Object.fromEntries(await Promise.all(modules.map(async module => {
      if (!profile.enabledModules.includes(module)) return [module, "disabled"];
      try {
        const r = await db.rpc("current_user_module_allowed", { p_business: id, p_module: module });
        return [module, r.error || typeof r.data !== "boolean" ? "unavailable" : r.data ? "allowed" : "disabled"];
      } catch { return [module, "unavailable"]; }
    })));
  }
  const allowed = await permissions();
  let range: Briefing["range"] = null;
  try { range = reportingRange(period, business.timezone, now); } catch { /* Explicit unavailable; never guess UTC. */ }
  const cutoff = range ? new Date(Math.min(now.getTime(), Date.parse(range.to))).toISOString() : null;
  type CountResult = { count: number | null; error: unknown };
  async function read(module: string, path: string, query: () => PromiseLike<CountResult>, needsRange = true): Promise<Reading> {
    const status = allowed[module];
    const common = { href: `${base}/${path}`, checkedAt: new Date().toISOString() };
    if (status === "disabled") return { ...common, status: "disabled", count: null, reason: "module_off" };
    if (status !== "allowed") return { ...common, status: "unavailable", count: null, reason: "permission_unavailable" };
    if (needsRange && !range) return { ...common, status: "unavailable", count: null, reason: "timezone_invalid" };
    try {
      const result = await query();
      if (result.error || !Number.isSafeInteger(result.count) || result.count! < 0) throw Error("count_unavailable");
      return { ...common, checkedAt: new Date().toISOString(), status: "available", count: result.count };
    } catch {
      return { ...common, checkedAt: new Date().toISOString(), status: "unavailable", count: null, reason: "query_failed" };
    }
  }
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true })
    .eq("business_id", id).gte("created_at", range!.from).lt("created_at", cutoff!);
  const [messages, orders, customers, bookings, handoffs, integrationFailures] = await Promise.all([
    // Unique channel-connection/external_message_id constraints deduplicate inbound retries.
    // created_at means DB recording time, not the provider's event timestamp.
    read("inbox", "inbox", () => count("messages").eq("direction", "inbound").eq("source", "customer")),
    read("orders", "orders", () => count("orders")),
    read("customers", "customers", () => count("customers")),
    read("bookings", "bookings", () => count("bookings")),
    // Current ownership snapshot, NOT a count of waiting customers or historical handoff events.
    read("inbox", "inbox", () => db.from("conversation_states")
      .select("conversation_id,conversations!inner(id)", { count: "exact", head: true })
      .eq("business_id", id).eq("conversations.business_id", id).eq("conversations.status", "paused")
      .or("collected->>staffHandoff.eq.true,and(collected->visual->>status.eq.handoff,or(collected->visual->>advisory.is.null,collected->visual->>advisory.eq.false))"), false),
    read("inbox", "activity", () => count("integration_logs").eq("status", "failed")),
  ]);
  // Discard the result after membership/config changes; RLS-denied empty rows must not become zero.
  const latest = await configuration();
  if (latest.timezone !== business.timezone || JSON.stringify(latest.dashboard_profile) !== JSON.stringify(business.dashboard_profile))
    throw new BriefingError(409);
  const currentPermissions = await permissions();
  const readings: [string, Reading][] = [["inbox", messages], ["orders", orders], ["customers", customers],
    ["bookings", bookings], ["inbox", handoffs], ["inbox", integrationFailures]];
  for (const [module, reading] of readings) {
    if (currentPermissions[module] !== "allowed") {
      reading.count = null;
      reading.status = currentPermissions[module] === "disabled" ? "disabled" : "unavailable";
      reading.reason = currentPermissions[module] === "disabled" ? "module_off" : "permission_unavailable";
    }
  }
  const metrics = { messages, orders, customers, bookings };
  return { businessId: id, businessName: business.name, timezone: business.timezone, period, range,
    ...(!range ? { configurationError: "timezone_invalid" as const } : {}),
    generatedAt: new Date().toISOString(), recordedBefore: cutoff, metrics, attention: { handoffs, integrationFailures },
    unavailableMetrics: (Object.keys(metrics) as MetricId[]).filter(key => metrics[key].status === "unavailable") };
}
