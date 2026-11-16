import { signedAvatarQuery } from "./avatar-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInstagramUserProfile, type InstagramUserProfile } from "@/lib/instagram/user-profile";

export const PARTICIPANT_AVATAR_BUCKET = "participant-avatars";
/** Provider photos change rarely; look again at most this often per participant. */
export const AVATAR_REFRESH_MS = 7 * 86_400_000;
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function avatarIsStale(checkedAt: string | null | undefined, now = Date.now()): boolean {
  const at = checkedAt ? Date.parse(checkedAt) : NaN;
  return !Number.isFinite(at) || now - at >= AVATAR_REFRESH_MS;
}

type RefreshInput = {
  db: SupabaseClient;
  businessId: string;
  connectionId: string;
  participantId: string;
  accessToken: string;
  /** Reuse a lookup this turn already made. */
  profile?: InstagramUserProfile | null;
};

async function download(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength && bytes.byteLength <= MAX_BYTES ? { bytes, type } : null;
}

/**
 * Copies the participant's Instagram profile photo into private storage and points every
 * conversation with that participant on this connection at it. Best effort: a failure never
 * blocks the message; only a definitive provider answer moves the next check a week out.
 */
export async function refreshInstagramParticipantAvatar(input: RefreshInput): Promise<"stored" | "none" | "skipped"> {
  const { db, businessId, connectionId, participantId } = input;
  if (!/^\d{1,32}$/.test(participantId)) return "skipped";
  const profile = input.profile?.ok ? input.profile : await fetchInstagramUserProfile(participantId, input.accessToken);
  if (!profile.ok) return "skipped";
  let path: string | null = null;
  if (profile.profilePic) {
    try {
      const image = await download(profile.profilePic);
      if (!image) return "skipped";
      const candidate = `${businessId}/instagram/${connectionId}/${participantId}.${TYPES[image.type]}`;
      const { error } = await db.storage.from(PARTICIPANT_AVATAR_BUCKET)
        .upload(candidate, image.bytes, { contentType: image.type, upsert: true, cacheControl: "86400" });
      if (error) return "skipped";
      path = candidate;
    } catch (error) {
      console.warn("[participant avatar] copy failed", error instanceof Error ? error.message : error);
      return "skipped";
    }
  }
  // No photo (removed, private, or blocked): clear it so the initials come back.
  const { error } = await db.from("conversations")
    .update({ participant_avatar_path: path, participant_avatar_checked_at: new Date().toISOString() })
    .eq("business_id", businessId).eq("instagram_connection_id", connectionId).eq("instagram_participant_id", participantId);
  if (error) console.warn("[participant avatar] update failed", error.message);
  return path ? "stored" : "none";
}

/**
 * Stable, signed address of a stored photo. Sign only while rendering for a viewer who may see this
 * conversation. The link changes when the photo is checked again or the weekly window turns over.
 * Null when there is no stored photo: the UI shows initials.
 */
export function participantAvatarUrl(businessId: string, conversationId: string, path: string | null | undefined, checkedAt: string | null | undefined, now = Date.now()): string | null {
  if (!path) return null;
  const at = checkedAt ? Date.parse(checkedAt) : NaN;
  const version = Number.isFinite(at) ? String(at) : "0";
  return `/api/businesses/${businessId}/conversations/${conversationId}/avatar?${signedAvatarQuery(businessId, conversationId, version, now)}`;
}
