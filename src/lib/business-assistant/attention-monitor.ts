import { createServiceSupabase } from "@/lib/supabase/service";
import { readAttentionEvidence } from "./attention";

/** Notifications are observations only. No operation executor is called here. */
export async function monitorBusinessAttention() {
  const db = createServiceSupabase();
  const started = Date.now();
  const preferences = await db.from("business_attention_preferences")
    .select("business_id,user_id,businesses!inner(slug)").eq("enabled", true)
    .order("last_attempt_at", { ascending: true, nullsFirst: true }).limit(100);
  if (preferences.error) throw Error("Nuk u lexuan preferencat e ndjekjes.");
  let checked = 0, created = 0, unavailable = 0;
  for (const pref of preferences.data ?? []) {
    if (Date.now() - started > 45000) break;
    const attempt = await db.from("business_attention_preferences").update({ last_attempt_at: new Date().toISOString() })
      .eq("business_id", pref.business_id).eq("user_id", pref.user_id);
    if (attempt.error) { unavailable++; continue; }
    const member = await db.from("business_users").select("user_id").eq("business_id", pref.business_id).eq("user_id", pref.user_id).maybeSingle();
    if (member.error) { unavailable++; continue; }
    if (!member.data) continue;
    const business = pref.businesses as unknown as { slug: string };
    const evidence = await readAttentionEvidence(db, { businessId: pref.business_id, userId: pref.user_id, slug: business.slug });
    // Partial evidence must not turn an unreadable problem into a resolved one.
    if (evidence.unavailable.length) { unavailable++; continue; }
    const recorded = await db.rpc("record_attention_check", { p_business: pref.business_id, p_user: pref.user_id, p_items: evidence.items });
    if (recorded.error) { unavailable++; continue; }
    checked++; created += Number(recorded.data ?? 0);
  }
  return { checked, created, unavailable, deferred: (preferences.data?.length ?? 0) - checked - unavailable };
}
