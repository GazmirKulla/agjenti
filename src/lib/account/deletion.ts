import { deleteBusinessCompletely } from "@/lib/businesses/delete-business";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { ACCOUNT_RECOVERY_DAYS } from "./deletion-notice";

const PERMANENT_BAN = "876000h";

export type ScheduleResult =
  | { ok: true; purgeAfter: string }
  | { ok: false; status: number; error: string };

/**
 * Disables sign-in immediately and schedules the purge. The ban outlives the
 * recovery window so a missed purge never re-enables the account.
 */
export async function scheduleAccountDeletion(
  userId: string,
  accessToken?: string,
): Promise<ScheduleResult> {
  if (await isPlatformAdmin(userId))
    return { ok: false, status: 403, error: "Llogaria e administratorit të platformës nuk mund të fshihet." };
  const db = createServiceSupabase();
  const { data, error } = await db
    .rpc("schedule_account_deletion", { p_user: userId, p_days: ACCOUNT_RECOVERY_DAYS })
    .single<{ purge_after: string; created: boolean }>();
  if (error?.code === "42501")
    return { ok: false, status: 403, error: "Llogaria e administratorit të platformës nuk mund të fshihet." };
  if (error || !data)
    return { ok: false, status: 503, error: "Fshirja nuk u regjistrua. Llogaria nuk u ndryshua; provo përsëri." };

  const ban = await db.auth.admin.updateUserById(userId, { ban_duration: PERMANENT_BAN });
  if (ban.error) {
    if (data.created) {
      const { error: rollback } = await db
        .from("account_deletions")
        .delete()
        .eq("user_id", userId)
        .eq("status", "scheduled");
      if (rollback) console.error("[account-deletion] rollback", rollback.message);
    }
    return { ok: false, status: 503, error: "Llogaria nuk u çaktivizua. Provo përsëri." };
  }

  const { error: devices } = await db.from("mobile_devices").delete().eq("user_id", userId);
  if (devices) console.error("[account-deletion] devices", devices.message);
  if (accessToken) {
    const { error: sessions } = await db.auth.admin.signOut(accessToken, "global");
    if (sessions) console.error("[account-deletion] sessions", sessions.message);
  }
  return { ok: true, purgeAfter: data.purge_after };
}

export type RestoreResult = { error: null } | { error: { code: "not_scheduled" | "failed" } };

export async function restoreAccountDeletion(userId: string): Promise<RestoreResult> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("account_deletions")
    .update({ status: "restored", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .select("user_id")
    .maybeSingle();
  if (error) return { error: { code: "failed" } };
  if (!data) return { error: { code: "not_scheduled" } };
  const unban = await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (!unban.error) return { error: null };
  const { error: revert } = await db
    .from("account_deletions")
    .update({ status: "scheduled", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "restored");
  if (revert) console.error("[account-deletion] restore revert", revert.message);
  return { error: { code: "failed" } };
}

/** Businesses without other members are deleted together with their last member. */
async function purgeAccount(userId: string) {
  const db = createServiceSupabase();
  const { data: links, error } = await db
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId);
  if (error) throw new Error("memberships");
  for (const { business_id } of links ?? []) {
    const { data: others, error: othersError } = await db
      .from("business_users")
      .select("user_id")
      .eq("business_id", business_id)
      .neq("user_id", userId)
      .limit(1);
    if (othersError) throw new Error("members");
    if (others?.length) continue;
    const removed = await deleteBusinessCompletely(business_id);
    if (!removed.ok && removed.status !== 404) throw new Error("business");
  }
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError && authError.status !== 404) throw new Error("auth");
}

export async function purgeDueAccountDeletions() {
  const db = createServiceSupabase();
  const { data: ids, error } = await db.rpc("claim_account_deletions", { p_limit: 20 });
  if (error) throw new Error("claim");
  let completed = 0;
  let failed = 0;
  for (const userId of (ids ?? []) as string[]) {
    try {
      await purgeAccount(userId);
      const { error: done } = await db
        .from("account_deletions")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("status", "purging");
      if (done) console.error("[account-deletion] completion", done.message);
      completed++;
    } catch (e) {
      failed++;
      console.error("[account-deletion] purge", userId, e instanceof Error ? e.message : e);
      await db
        .from("account_deletions")
        .update({ status: "scheduled", updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("status", "purging");
    }
  }
  return { completed, failed };
}
