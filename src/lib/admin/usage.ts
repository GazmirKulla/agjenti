import { createServiceSupabase } from "@/lib/supabase/service";
import { plans, type BillingPlan } from "@/lib/billing/service";

/** Platform statistics for administrators: AI messages counted against plans
 * and the OpenAI tokens behind them. Tokens are never shown to business users. */
export type UsageTotals = { messages: number; tokens: number; calls: number };
export type UserUsage = UsageTotals & { userId: string; email: string | null; name: string | null; plan: BillingPlan; limit: number; businesses: number };
export type BusinessUsage = UsageTotals & { businessId: string; name: string; slug: string; billingUserId: string | null };
export type PlatformUsage = {
  monthStart: string;
  totals: UsageTotals & { activeUsers: number };
  users: UserUsage[];
  businesses: BusinessUsage[];
  days: { day: string; tokens: number; calls: number }[];
  models: { model: string; tokens: number; calls: number }[];
};

/** First day of the current month in the platform's time zone (YYYY-MM-01). */
export function monthStart(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit" }).format(now) + "-01";
}

type TokenRow = { business_id: string; day: string; model: string; calls: number | string; input_tokens: number | string; output_tokens: number | string };
type MessageRow = { business_id: string; used: number | string };
type BusinessRow = { id: string; name: string; slug: string; billing_user_id: string | null };
type AccountRow = { user_id: string; plan: string };
type ProfileRow = { id: string; email: string | null; display_name: string | null };

const n = (value: unknown) => Number(value) || 0;

/** Pure aggregation, separate from loading so it can be tested. */
export function aggregateUsage(input: {
  monthStart: string; tokens: TokenRow[]; messages: MessageRow[]; businesses: BusinessRow[]; accounts: AccountRow[]; profiles: ProfileRow[];
}): PlatformUsage {
  const business = new Map<string, BusinessUsage>(input.businesses.map((b) => [b.id, {
    businessId: b.id, name: b.name, slug: b.slug, billingUserId: b.billing_user_id, messages: 0, tokens: 0, calls: 0,
  }]));
  const days = new Map<string, { tokens: number; calls: number }>();
  const models = new Map<string, { tokens: number; calls: number }>();
  for (const row of input.tokens) {
    const tokens = n(row.input_tokens) + n(row.output_tokens), calls = n(row.calls);
    const b = business.get(row.business_id);
    if (b) { b.tokens += tokens; b.calls += calls; }
    const d = days.get(row.day) ?? { tokens: 0, calls: 0 };
    days.set(row.day, { tokens: d.tokens + tokens, calls: d.calls + calls });
    const m = models.get(row.model) ?? { tokens: 0, calls: 0 };
    models.set(row.model, { tokens: m.tokens + tokens, calls: m.calls + calls });
  }
  for (const row of input.messages) {
    const b = business.get(row.business_id);
    if (b) b.messages += n(row.used);
  }
  const plan = new Map(input.accounts.map((a) => [a.user_id, (a.plan in plans ? a.plan : "free") as BillingPlan]));
  const profile = new Map(input.profiles.map((p) => [p.id, p]));
  const users = new Map<string, UserUsage>();
  for (const b of business.values()) {
    if (!b.billingUserId) continue;
    const userPlan = plan.get(b.billingUserId) ?? "free";
    const u = users.get(b.billingUserId) ?? {
      userId: b.billingUserId, email: profile.get(b.billingUserId)?.email ?? null, name: profile.get(b.billingUserId)?.display_name ?? null,
      plan: userPlan, limit: plans[userPlan].monthlyLimit, businesses: 0, messages: 0, tokens: 0, calls: 0,
    };
    u.businesses += 1; u.messages += b.messages; u.tokens += b.tokens; u.calls += b.calls;
    users.set(b.billingUserId, u);
  }
  const list = [...business.values()];
  const byUse = <T extends UsageTotals>(a: T, b: T) => b.messages - a.messages || b.tokens - a.tokens;
  return {
    monthStart: input.monthStart,
    totals: {
      messages: list.reduce((s, b) => s + b.messages, 0),
      tokens: list.reduce((s, b) => s + b.tokens, 0),
      calls: list.reduce((s, b) => s + b.calls, 0),
      activeUsers: [...users.values()].filter((u) => u.messages || u.tokens).length,
    },
    users: [...users.values()].sort(byUse),
    businesses: list.sort(byUse),
    days: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    models: [...models].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens),
  };
}

export async function loadPlatformUsage(now = new Date()): Promise<PlatformUsage> {
  const db = createServiceSupabase();
  const start = monthStart(now);
  const [tokens, messages, businesses, accounts] = await Promise.all([
    db.from("ai_usage_daily").select("business_id,day,model,calls,input_tokens,output_tokens").gte("day", start),
    // Every delivered AI message is recorded per business, whoever pays for it.
    db.from("business_usage").select("business_id,used").gte("period_end", new Date().toISOString()),
    db.from("businesses").select("id,name,slug,billing_user_id"),
    db.from("account_billing").select("user_id,plan"),
  ]);
  if (tokens.error || messages.error || businesses.error || accounts.error) throw new Error("Statistikat nuk u ngarkuan.");
  const payers = [...new Set((businesses.data ?? []).flatMap((b) => (b.billing_user_id ? [b.billing_user_id] : [])))];
  const profiles = payers.length ? await db.from("profiles").select("id,email,display_name").in("id", payers) : { data: [] as ProfileRow[], error: null };
  return aggregateUsage({
    monthStart: start, tokens: tokens.data ?? [], messages: messages.data ?? [], businesses: businesses.data ?? [],
    accounts: accounts.data ?? [], profiles: profiles.data ?? [],
  });
}
