import { createServiceSupabase } from "@/lib/supabase/service";
export type DashboardStats = {
  conversations: number;
  orders: number;
  customers: number;
  connections: number;
  agents: number;
  paused: number;
  totalBusinesses: number;
  trend: { date: string; conversations: number; orders: number }[];
};
export async function getDashboardStats(
  businessId?: string,
): Promise<DashboardStats> {
  const db = createServiceSupabase();
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(now.getTime() - (6 - i) * 86400000),
  );
  const { data, error } = await db.rpc("dashboard_stats", {
    p_business_id: businessId ?? null,
    p_start: days[0].toISOString(),
  });
  if (!error && data) return data as DashboardStats;
  // Rollout compatibility only: do not mask permission or database failures.
  if (!error || !["PGRST202", "42883"].includes(error.code))
    throw new Error("Nuk u ngarkuan statistikat e panelit.");
  async function count(
    table: string,
    filter?: [string, string],
    start?: Date,
    end?: Date,
  ) {
    let query = db.from(table).select("id", { count: "exact", head: true });
    if (businessId) query = query.eq("business_id", businessId);
    if (filter) query = query.eq(...filter);
    if (start) query = query.gte("created_at", start.toISOString());
    if (end) query = query.lt("created_at", end.toISOString());
    const result = await query;
    if (result.error) throw new Error("Nuk u ngarkuan statistikat e panelit.");
    return result.count ?? 0;
  }
  const [
    conversations,
    orders,
    customers,
    connections,
    agents,
    paused,
    totalBusinesses,
    trend,
  ] = await Promise.all([
    count("conversations"),
    count("orders"),
    businessId ? count("customers") : Promise.resolve(0),
    count("instagram_connections", ["status", "connected"]),
    count("ai_agents", ["is_active", "true"]),
    count("conversations", ["status", "paused"]),
    businessId ? Promise.resolve(0) : count("businesses"),
    Promise.all(
      days.map(async (date) => {
        const end = new Date(date.getTime() + 86400000);
        const [conversations, orders] = await Promise.all([
          count("conversations", undefined, date, end),
          count("orders", undefined, date, end),
        ]);
        return { date: date.toISOString(), conversations, orders };
      }),
    ),
  ]);
  return {
    conversations,
    orders,
    customers,
    connections,
    agents,
    paused,
    totalBusinesses,
    trend,
  };
}
