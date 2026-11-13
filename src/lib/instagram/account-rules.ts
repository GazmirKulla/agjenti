import { createServiceSupabase } from "@/lib/supabase/service";
import type { InstagramBusinessProfile } from "./business-profile";
import type { InstagramPost } from "./media";

/** Rules shared by every public read by username: onboarding, settings and the
 * Agjenti.app prospect chat. */

/** Shown to an owner whose Instagram already belongs to another business. Never names it. */
export const CONNECTED_ELSEWHERE_MESSAGE = "Ky Instagram është i lidhur me një biznes tjetër në Agjenti. Nëse është i yti, lidhe me Instagram login. Mund të vazhdosh edhe pa të.";
/** Shown when the account is public but has nothing to learn from yet. */
export const EMPTY_PROFILE_MESSAGE = "Ky profil nuk ka ende postime ose përshkrim për t'u analizuar. Mund të vazhdosh pa të dhe ta shtosh më vonë.";
/** A read this recent is reused instead of paying for the same account again
 * (Instagram image links expire after a few hours). */
export const FRESH_READ_MS = 6 * 3600_000;

type Db = ReturnType<typeof createServiceSupabase>;

/** The account is connected (Instagram login) to a business other than `exceptBusinessId`.
 * Only a login proves ownership; a username typed by someone is not checked here. */
export async function connectedToAnotherBusiness(username: string, exceptBusinessId: string | null, db: Db = createServiceSupabase()) {
  let query = db.from("instagram_connections").select("business_id").eq("username", username.toLowerCase()).eq("status", "connected");
  if (exceptBusinessId) query = query.neq("business_id", exceptBusinessId);
  const { data, error } = await query.limit(1);
  // An unverified answer blocks nothing: it is public data, and the owner can retry.
  if (error) return false;
  return (data ?? []).length > 0;
}

/** No posts, no description and no name: there is nothing to analyse or propose from. */
export function emptyPublicProfile(read: { profile: InstagramBusinessProfile | null | undefined; posts: InstagramPost[] | unknown[] | null | undefined }) {
  const profile = read.profile ?? {};
  const posts = Array.isArray(read.posts) ? read.posts as { caption?: string | null; imageUrl?: string | null }[] : [];
  const usefulPost = posts.some(post => post && (post.caption?.trim() || post.imageUrl));
  return !usefulPost && !profile.biography?.trim() && !profile.website?.trim();
}

export type PublicRead = { profile: InstagramBusinessProfile; posts: InstagramPost[]; stats?: { followers?: number; posts?: number }; fetchedAt: string };

/** A read of the same public account from the last hours, from a prospect chat
 * or an onboarding preview, so the account is not paid for twice. */
export async function recentPublicRead(username: string, db: Db = createServiceSupabase(), now = Date.now()): Promise<PublicRead | null> {
  const since = new Date(now - FRESH_READ_MS).toISOString();
  const [scan, preview] = await Promise.all([
    db.from("prospect_scans").select("profile,posts,stats,fetched_at").eq("username", username).eq("status", "ready")
      .gte("fetched_at", since).order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("business_source_previews").select("instagram").eq("instagram->>username", username)
      .gte("instagram->>fetchedAt", since).limit(1).maybeSingle(),
  ]);
  if (scan.data?.profile && Array.isArray(scan.data.posts) && scan.data.fetched_at)
    return { profile: scan.data.profile, posts: scan.data.posts, stats: scan.data.stats ?? undefined, fetchedAt: scan.data.fetched_at };
  const saved = preview.data?.instagram as { profile?: InstagramBusinessProfile; posts?: InstagramPost[]; stats?: PublicRead["stats"]; fetchedAt?: string } | null | undefined;
  if (saved?.profile && Array.isArray(saved.posts) && saved.fetchedAt && now - new Date(saved.fetchedAt).getTime() < FRESH_READ_MS)
    return { profile: saved.profile, posts: saved.posts, stats: saved.stats, fetchedAt: saved.fetchedAt };
  return null;
}
