import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeInstagramUsername, publicScanAvailable } from "@/lib/instagram/public-profile";
import { enqueuePublicInstagram } from "./queue";

export type UsernameResult =
  | { error: string }
  | { username: string | null; scanning: boolean; waiting: boolean };

/** A business is read by username only once: a scan that completed, or is
 * still going, is not repeated. Only a failed one may be tried again. */
async function usernameScanUsed(businessId: string) {
  const { data } = await createServiceSupabase().from("business_discovery_jobs").select("id")
    .eq("business_id", businessId).eq("source", "instagram").not("input->>username", "is", null)
    .in("status", ["queued", "running", "completed"]).limit(1).maybeSingle();
  return Boolean(data);
}

/** Saves the business's public @username and, when reading by username is
 * enabled, the account is not connected and it was never read by username,
 * starts the one public scan. An empty value removes the username. */
export async function saveInstagramUsername(businessId: string, userId: string, raw: unknown): Promise<UsernameResult> {
  const empty = typeof raw !== "string" || !raw.trim();
  const username = empty ? null : normalizeInstagramUsername(raw);
  if (!empty && !username) return { error: "Shkruaj një username të vlefshëm Instagram-i, p.sh. @dyqani.im" };
  const db = createServiceSupabase();
  const { error } = await db.from("businesses").update({ instagram_username: username }).eq("id", businessId);
  if (error) return { error: "Username nuk u ruajt. Provo përsëri." };
  if (!username) return { username: null, scanning: false, waiting: false };
  // A connected account is read through its connection, which sees more.
  const { data: connection } = await db.from("instagram_connections").select("id").eq("business_id", businessId).eq("status", "connected").maybeSingle();
  if (connection) return { username, scanning: false, waiting: false };
  if (!publicScanAvailable()) return { username, scanning: false, waiting: true };
  if (await usernameScanUsed(businessId)) return { username, scanning: false, waiting: false };
  try {
    await enqueuePublicInstagram(businessId, userId, username);
    return { username, scanning: true, waiting: false };
  } catch {
    return { username, scanning: false, waiting: true };
  }
}

/** Once reading by username is enabled: scan businesses that gave a username
 * earlier and were never read, on behalf of the person who pays for them. */
export async function queuePendingUsernameScans(limit = 10) {
  if (!publicScanAvailable()) return 0;
  const db = createServiceSupabase();
  const { data } = await db.from("businesses").select("id,instagram_username,billing_user_id")
    .not("instagram_username", "is", null).not("billing_user_id", "is", null).limit(200);
  let queued = 0;
  for (const business of data ?? []) {
    if (queued >= limit) break;
    const [{ data: connection }, { data: job }] = await Promise.all([
      db.from("instagram_connections").select("id").eq("business_id", business.id).eq("status", "connected").maybeSingle(),
      db.from("business_discovery_jobs").select("id").eq("business_id", business.id).eq("source", "instagram").limit(1).maybeSingle(),
    ]);
    if (connection || job) continue;
    try { await enqueuePublicInstagram(business.id, business.billing_user_id, business.instagram_username); queued++; }
    catch { /* The next run tries again. */ }
  }
  return queued;
}
