import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto/tokens";
import { AVATAR_REFRESH_MS, refreshInstagramParticipantAvatar } from "./participant-avatar";

/** Contacts quiet for longer keep what they have; Instagram may no longer answer for them. */
export const AVATAR_ACTIVE_WINDOW_MS = 90 * 86_400_000;

export type AvatarBackfillOptions = {
  now?: number;
  /** Stop starting new lookups after this long; the next run continues. */
  budgetMs?: number;
  /** Instagram lookups per business account per run, well under its hourly limit. */
  perConnection?: number;
  total?: number;
  concurrency?: number;
  refresh?: typeof refreshInstagramParticipantAvatar;
  decrypt?: (ciphertext: string) => string;
};

type Candidate = { business_id: string; instagram_connection_id: string; instagram_participant_id: string };

/**
 * Fills in and refreshes customer profile photos for people who have not written recently:
 * never checked first, then the oldest checks, most recently active contacts first.
 * Each participant is looked up once per run; a lookup that does not answer waits a week.
 */
export async function runAvatarBackfill(db: SupabaseClient, options: AvatarBackfillOptions = {}) {
  const now = options.now ?? Date.now();
  // Wall clock, not the logical `now`: the budget is about this run's duration.
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  const perConnection = options.perConnection ?? 100;
  const total = options.total ?? 300;
  const refresh = options.refresh ?? refreshInstagramParticipantAvatar;
  const decrypt = options.decrypt ?? decryptSecret;
  const stale = new Date(now - AVATAR_REFRESH_MS).toISOString();

  const { data: rows, error } = await db.from("conversations")
    .select("business_id,instagram_connection_id,instagram_participant_id")
    .eq("channel", "instagram")
    .not("instagram_participant_id", "is", null)
    .not("instagram_connection_id", "is", null)
    .gte("last_message_at", new Date(now - AVATAR_ACTIVE_WINDOW_MS).toISOString())
    .or(`participant_avatar_checked_at.is.null,participant_avatar_checked_at.lt.${stale}`)
    .order("participant_avatar_checked_at", { ascending: true, nullsFirst: true })
    .order("last_message_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Avatar candidates unavailable");

  const seen = new Set<string>();
  const perConn = new Map<string, number>();
  const queue: Candidate[] = [];
  for (const row of (rows ?? []) as Candidate[]) {
    const key = `${row.instagram_connection_id}:${row.instagram_participant_id}`;
    const count = perConn.get(row.instagram_connection_id) ?? 0;
    if (seen.has(key) || count >= perConnection || queue.length >= total) continue;
    seen.add(key);
    perConn.set(row.instagram_connection_id, count + 1);
    queue.push(row);
  }
  const summary = { candidates: queue.length, stored: 0, none: 0, skipped: 0, unreachable: 0 };
  if (!queue.length) return summary;

  const { data: connections, error: connectionError } = await db.from("instagram_connections")
    .select("id,business_id,access_token_ciphertext").eq("status", "connected").in("id", [...perConn.keys()]);
  if (connectionError) throw new Error("Avatar connections unavailable");
  const tokens = new Map<string, { businessId: string; token: string | null }>();
  for (const c of connections ?? []) {
    let token: string | null = null;
    try { token = decrypt(c.access_token_ciphertext as string); } catch { token = null; }
    tokens.set(c.id as string, { businessId: c.business_id as string, token });
  }

  const markChecked = async (row: Candidate) => {
    await db.from("conversations").update({ participant_avatar_checked_at: new Date(now).toISOString() })
      .eq("business_id", row.business_id).eq("instagram_connection_id", row.instagram_connection_id)
      .eq("instagram_participant_id", row.instagram_participant_id);
  };

  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const row = queue[next++];
      const connection = tokens.get(row.instagram_connection_id);
      // A disconnected account, a token that cannot be read, or a business mismatch: never look up.
      if (!connection?.token || connection.businessId !== row.business_id) { summary.unreachable += 1; continue; }
      try {
        const outcome = await refresh({ db, businessId: row.business_id, connectionId: row.instagram_connection_id,
          participantId: row.instagram_participant_id, accessToken: connection.token });
        summary[outcome] += 1;
        if (outcome === "skipped") await markChecked(row);
      } catch {
        summary.skipped += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, queue.length)) }, worker));
  return summary;
}
