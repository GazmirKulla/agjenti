import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto/tokens";
import { cleanBusinessProfile } from "@/lib/instagram/business-profile";
import { graphVersion } from "@/lib/instagram/oauth";

/**
 * The business's logo: shown in the panel instead of its initials. It comes from the connected
 * Instagram account's profile photo, copied here because Instagram's links expire, or from an
 * upload by the owner. An uploaded logo is never replaced by Instagram; removing it lets
 * Instagram fill it again.
 */
export const BUSINESS_LOGO_BUCKET = "business-logos";
/** Instagram photos change rarely: look again at most this often per business. */
export const LOGO_REFRESH_MS = 7 * 86_400_000;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { ext: "webp", magic: b => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

export type LogoSource = "instagram" | "manual";
export type BusinessLogo = { url: string | null; source: LogoSource | null; checkedAt: string | null };

export function logoIsStale(checkedAt: string | null | undefined, now = Date.now()): boolean {
  const at = checkedAt ? Date.parse(checkedAt) : NaN;
  return !Number.isFinite(at) || now - at >= LOGO_REFRESH_MS;
}

/** True when the bytes really are the image type they claim to be. */
export function validLogoImage(bytes: Uint8Array, type: string): boolean {
  const known = LOGO_TYPES[type];
  return Boolean(known && bytes.byteLength && bytes.byteLength <= LOGO_MAX_BYTES && known.magic(bytes));
}

/** The storage path inside the bucket of a logo URL this module stored; null for anything else. */
export function logoPathFromUrl(url: string | null | undefined): string | null {
  const marker = `/storage/v1/object/public/${BUSINESS_LOGO_BUCKET}/`;
  const at = url?.indexOf(marker) ?? -1;
  return url && at >= 0 ? decodeURIComponent(url.slice(at + marker.length).split("?")[0]) : null;
}

/** The logo columns, or nothing before the migration adds them: callers then show initials. */
export async function loadBusinessLogo(db: SupabaseClient, businessId: string): Promise<BusinessLogo | null> {
  const { data, error } = await db.from("businesses").select("logo_url,logo_source,logo_checked_at").eq("id", businessId).maybeSingle();
  if (error || !data) return null;
  return { url: data.logo_url ?? null, source: data.logo_source ?? null, checkedAt: data.logo_checked_at ?? null };
}

/** Stores the image under the business's folder, points the business at it and removes the previous file. */
export async function storeBusinessLogo(db: SupabaseClient, businessId: string, bytes: Uint8Array, type: string, source: LogoSource): Promise<string | null> {
  if (!validLogoImage(bytes, type)) return null;
  const previous = await loadBusinessLogo(db, businessId);
  const path = `${businessId}/${source}-${randomUUID()}.${LOGO_TYPES[type].ext}`;
  let upload = await db.storage.from(BUSINESS_LOGO_BUCKET).upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
  if (upload.error && (await db.storage.getBucket(BUSINESS_LOGO_BUCKET)).error) {
    // Before the migration runs: the same public bucket it creates.
    await db.storage.createBucket(BUSINESS_LOGO_BUCKET, { public: true, fileSizeLimit: LOGO_MAX_BYTES, allowedMimeTypes: Object.keys(LOGO_TYPES) });
    upload = await db.storage.from(BUSINESS_LOGO_BUCKET).upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
  }
  if (upload.error) return null;
  const url = db.storage.from(BUSINESS_LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await db.from("businesses")
    .update({ logo_url: url, logo_source: source, logo_checked_at: new Date().toISOString() }).eq("id", businessId);
  if (error) {
    await db.storage.from(BUSINESS_LOGO_BUCKET).remove([path]);
    return null;
  }
  const old = logoPathFromUrl(previous?.url);
  if (old && old !== path) await db.storage.from(BUSINESS_LOGO_BUCKET).remove([old]);
  return url;
}

/** Removes the logo; the business shows its initials until Instagram fills it again. */
export async function removeBusinessLogo(db: SupabaseClient, businessId: string): Promise<boolean> {
  const previous = await loadBusinessLogo(db, businessId);
  const { error } = await db.from("businesses").update({ logo_url: null, logo_source: null, logo_checked_at: null }).eq("id", businessId);
  if (error) return false;
  const old = logoPathFromUrl(previous?.url);
  if (old) await db.storage.from(BUSINESS_LOGO_BUCKET).remove([old]);
  return true;
}

async function download(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!LOGO_TYPES[type]) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) return null;
  return { bytes: new Uint8Array(await response.arrayBuffer()), type };
}

/**
 * The account's profile photo link: a string, null when Instagram answered without one, or
 * undefined when it did not answer (a rejected or expired token, a timeout) so the caller retries.
 */
async function readProfilePicture(token: string, accountId: string): Promise<{ profile_picture_url?: string } | undefined> {
  try {
    const url = new URL(`https://graph.instagram.com/${graphVersion()}/${encodeURIComponent(accountId)}`);
    url.searchParams.set("fields", "profile_picture_url");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!response.ok) return undefined;
    const raw = await response.json();
    return { profile_picture_url: cleanBusinessProfile(raw && typeof raw === "object" ? raw : {}).profile_picture_url };
  } catch { return undefined; } // Never log credentials or provider errors.
}

type InstagramLogoDeps = {
  decrypt?: (ciphertext: string) => string;
  /** Undefined when Instagram did not answer. */
  readProfile?: (token: string, accountId: string) => Promise<{ profile_picture_url?: string } | undefined>;
  fetchImage?: (url: string) => Promise<{ bytes: Uint8Array; type: string } | null>;
};

/**
 * Copies the connected Instagram account's profile photo as the business's logo. Best effort: an
 * uploaded logo is kept, and a missing connection or a failed read changes nothing, so the next
 * run tries again. Only an answer from Instagram moves the next check a week out.
 */
export async function refreshInstagramBusinessLogo(db: SupabaseClient, businessId: string, deps: InstagramLogoDeps = {}): Promise<"stored" | "none" | "kept" | "skipped"> {
  const logo = await loadBusinessLogo(db, businessId);
  if (!logo) return "skipped"; // Before the migration.
  if (logo.source === "manual") return "kept";
  const { data: conn } = await db.from("instagram_connections").select("ig_user_id,access_token_ciphertext,status")
    .eq("business_id", businessId).eq("status", "connected").maybeSingle();
  if (!conn?.access_token_ciphertext || !conn.ig_user_id) return "skipped";
  try {
    const token = (deps.decrypt ?? decryptSecret)(conn.access_token_ciphertext);
    const profile = await (deps.readProfile ?? readProfilePicture)(token, conn.ig_user_id);
    if (!profile) return "skipped"; // No answer (e.g. an expired token): try again on the next run.
    if (!profile.profile_picture_url) {
      // No photo on the account: keep what we have but wait a week before asking again.
      await db.from("businesses").update({ logo_checked_at: new Date().toISOString() }).eq("id", businessId);
      return "none";
    }
    const image = await (deps.fetchImage ?? download)(profile.profile_picture_url);
    if (!image) return "skipped";
    return await storeBusinessLogo(db, businessId, image.bytes, image.type, "instagram") ? "stored" : "skipped";
  } catch (error) {
    console.warn("[business logo] instagram copy failed", error instanceof Error ? error.message : error);
    return "skipped";
  }
}

/**
 * Daily: logos for businesses with a connected Instagram account whose logo came from Instagram
 * (or is missing) and was last checked more than a week ago. Uploaded logos are never touched.
 */
export async function runBusinessLogoRefresh(db: SupabaseClient, options: { now?: number; budgetMs?: number; refresh?: typeof refreshInstagramBusinessLogo } = {}) {
  const now = options.now ?? Date.now();
  const deadline = Date.now() + (options.budgetMs ?? 60_000);
  const refresh = options.refresh ?? refreshInstagramBusinessLogo;
  const { data: conns } = await db.from("instagram_connections").select("business_id").eq("status", "connected");
  const ids = [...new Set((conns ?? []).map(c => c.business_id as string))];
  const summary = { checked: 0, stored: 0, none: 0, kept: 0, skipped: 0 };
  if (!ids.length) return summary;
  const { data: rows, error } = await db.from("businesses").select("id,logo_source,logo_checked_at").in("id", ids);
  if (error) return summary; // Before the migration.
  for (const row of rows ?? []) {
    if (Date.now() > deadline) break;
    if (row.logo_source === "manual" || !logoIsStale(row.logo_checked_at, now)) continue;
    summary.checked += 1;
    summary[await refresh(db, row.id)] += 1;
  }
  return summary;
}

/**
 * Logos of several businesses by id. Never throws: it runs while resolving business access, so a
 * failure (or the columns missing before the migration) only means initials instead of logos.
 */
export async function loadBusinessLogos(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  try {
    const { data, error } = await db.from("businesses").select("id,logo_url").in("id", ids);
    if (error || !Array.isArray(data)) return new Map();
    return new Map(data.filter(row => typeof row.logo_url === "string" && row.logo_url).map(row => [row.id as string, row.logo_url as string]));
  } catch {
    return new Map();
  }
}
