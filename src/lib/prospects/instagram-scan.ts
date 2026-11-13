import { createServiceSupabase } from "@/lib/supabase/service";
import { fetchPublicInstagram, normalizeInstagramUsername, publicScanAvailable, PublicInstagramError } from "@/lib/instagram/public-profile";
import type { InstagramBusinessProfile } from "@/lib/instagram/business-profile";
import type { InstagramPost } from "@/lib/instagram/media";
import { moduleRegistry } from "@/lib/dashboard/modules/registry";
import { connectedToAnotherBusiness, emptyPublicProfile, recentPublicRead } from "@/lib/instagram/account-rules";

/** A platform power, allowed per business by a platform admin (Agjenti.app). */
export const PROSPECT_SCAN_ACTION = "prospect.instagram_scan";
/** Used when no monthly limit is set for the business or its plan. */
export const DEFAULT_MONTHLY_SCANS = 50;
/** Different accounts one chat may have read. */
export const MAX_SCANS_PER_CONVERSATION = 2;
/** How long the reply waits for a scan started in the same turn. */
export const REPLY_WAIT_MS = 12_000;
/** A private or unknown account may be read again after this (it may have gone public). */
export const NOT_FOUND_RETRY_MS = 3600_000;

export type ProspectScanStatus = "queued" | "running" | "ready" | "not_found" | "failed";
export type ProspectScan = {
  id: string; business_id: string; conversation_id: string; username: string; status: ProspectScanStatus;
  profile: InstagramBusinessProfile | null; posts: InstagramPost[] | null; stats: { followers?: number; posts?: number } | null;
  error: string | null; fetched_at: string | null; updated_at: string; target_business_id?: string | null;
};
const columns = "id,business_id,conversation_id,username,status,profile,posts,stats,error,fetched_at,updated_at,target_business_id";

const reservedPaths = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct", "tv", "about", "developer", "legal"]);

/** The Instagram account the prospect named in their own message: a profile
 * link or an "@username" word. Emails and post links are not usernames. The
 * business's own account is never scanned. */
export function prospectUsernameFromMessage(message: string, ownUsername?: string | null): string | null {
  const own = ownUsername ? normalizeInstagramUsername(ownUsername) : null;
  const candidates: string[] = [];
  for (const match of message.matchAll(/instagram\.com\/([A-Za-z0-9._]+)/gi))
    if (!reservedPaths.has(match[1].toLowerCase())) candidates.push(match[1]);
  for (const match of message.matchAll(/(?:^|[\s(,:;"'“])@([A-Za-z0-9._]{1,30})(?![A-Za-z0-9._@])/g))
    candidates.push(match[1]);
  for (const raw of candidates) {
    const username = normalizeInstagramUsername(raw.replace(/\.+$/, ""));
    if (username && username !== own) return username;
  }
  return null;
}

type Db = ReturnType<typeof createServiceSupabase>;

/** Allowed for the business, the provider is configured, and the monthly allowance. */
export async function prospectScanPolicy(businessId: string, db: Db = createServiceSupabase()) {
  if (!publicScanAvailable()) return { allowed: false, monthlyLimit: 0 };
  const { data, error } = await db.rpc("prospect_scan_policy", { p_business: businessId });
  if (error || !data || typeof data !== "object") return { allowed: false, monthlyLimit: 0 };
  const policy = data as { allowed?: unknown; monthlyLimit?: unknown };
  return { allowed: policy.allowed === true,
    monthlyLimit: typeof policy.monthlyLimit === "number" && Number.isSafeInteger(policy.monthlyLimit) ? policy.monthlyLimit : DEFAULT_MONTHLY_SCANS };
}

function monthStart(now = new Date()) {
  // Months follow the business's clock (Europe/Tirane), like action quotas.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find(p => p.type === "year")!.value, month = parts.find(p => p.type === "month")!.value;
  return new Date(`${year}-${month}-01T00:00:00+01:00`).toISOString();
}

export type ScanRequest =
  | { kind: "existing"; scan: ProspectScan }
  | { kind: "queued"; scan: ProspectScan }
  | { kind: "refused"; reason: "conversation_limit" | "monthly_limit" | "unavailable" | "already_registered"; username: string };

/** Reuses this chat's read of the account, or queues one within the limits. */
export async function requestProspectScan(p: { businessId: string; conversationId: string; username: string; monthlyLimit: number }, db: Db = createServiceSupabase()): Promise<ScanRequest> {
  const existing = await db.from("prospect_scans").select(columns).eq("business_id", p.businessId).eq("conversation_id", p.conversationId)
    .order("created_at", { ascending: false }).limit(10);
  if (existing.error) return { kind: "refused", reason: "unavailable", username: p.username };
  const rows = (existing.data ?? []) as ProspectScan[];
  // A business already on Agjenti (Instagram login) is never read or invited again.
  if (await connectedToAnotherBusiness(p.username, p.businessId, db)) return { kind: "refused", reason: "already_registered", username: p.username };
  const same = rows.find(row => row.username === p.username);
  // A failed read may be tried again on a later message (the worker caps attempts);
  // a private or unknown account after an hour, in case it went public or was a typo.
  const retry = same && (same.status === "failed" || same.status === "not_found" && Date.now() - new Date(same.updated_at).getTime() > NOT_FOUND_RETRY_MS);
  if (same && !retry) return { kind: "existing", scan: same };
  // Accounts that were not found do not use up the chat's allowance.
  const counted = rows.filter(row => row.status !== "not_found" && row.status !== "failed");
  if (!same && counted.length >= MAX_SCANS_PER_CONVERSATION) return { kind: "refused", reason: "conversation_limit", username: p.username };
  const month = await db.from("prospect_scans").select("id", { count: "exact", head: true }).eq("business_id", p.businessId)
    .gte("created_at", monthStart()).not("status", "in", "(failed,not_found)");
  if (month.error) return { kind: "refused", reason: "unavailable", username: p.username };
  if ((month.count ?? 0) >= p.monthlyLimit) return { kind: "refused", reason: "monthly_limit", username: p.username };
  const saved = same
    ? await db.from("prospect_scans").update({ status: "queued", error: null, attempts: 0, leased_until: null, updated_at: new Date().toISOString() })
      .eq("id", same.id).in("status", ["failed", "not_found"]).select(columns).maybeSingle()
    : await db.from("prospect_scans").insert({ business_id: p.businessId, conversation_id: p.conversationId, username: p.username })
      .select(columns).maybeSingle();
  if (saved.error?.code === "23505") {
    const raced = await db.from("prospect_scans").select(columns).eq("business_id", p.businessId).eq("conversation_id", p.conversationId).eq("username", p.username).maybeSingle();
    if (raced.data) return { kind: "existing", scan: raced.data as ProspectScan };
  }
  if (saved.error || !saved.data) return { kind: "refused", reason: "unavailable", username: p.username };
  return { kind: "queued", scan: saved.data as ProspectScan };
}

type RunDeps = { fetcher?: typeof fetchPublicInstagram; db?: Db; recent?: typeof recentPublicRead };

/** Reads one claimed scan. Captions are kept short; nothing private is read. */
export async function runProspectScan(id: string, deps: RunDeps = {}): Promise<ProspectScanStatus | null> {
  const db = deps.db ?? createServiceSupabase();
  const claimed = await db.rpc("claim_prospect_scan", { p_id: id });
  const scan = claimed.data as ProspectScan | null;
  if (claimed.error || !scan?.id) return null;
  const done = (fields: Record<string, unknown>) => db.from("prospect_scans")
    .update({ ...fields, leased_until: null, updated_at: new Date().toISOString() }).eq("id", scan.id).eq("status", "running");
  const read = await readPublicAccount(scan.username, { ...deps, db });
  await done(read.status === "ready" ? { status: "ready", profile: read.profile, posts: read.posts, stats: read.stats, error: null, fetched_at: read.fetched_at }
    : { status: read.status, error: read.error });
  return read.status;
}

/** One public read of an account: a recent read is reused, captions are kept
 * short, and a private or unknown account is told apart from a failure. */
export async function readPublicAccount(username: string, deps: RunDeps = {}): Promise<Pick<ProspectScan, "status" | "profile" | "posts" | "stats" | "error" | "fetched_at">> {
  try {
    // The same public account read in the last hours (another chat, an onboarding) is reused.
    const recent = await (deps.recent ?? recentPublicRead)(username, deps.db).catch(() => null);
    const read = recent ?? await (deps.fetcher ?? fetchPublicInstagram)(username);
    const posts = read.posts.map(post => ({ ...post, caption: post.caption?.slice(0, 1500) ?? null }));
    return { status: "ready", profile: read.profile, posts, stats: read.stats ?? null, error: null, fetched_at: recent?.fetchedAt ?? new Date().toISOString() };
  } catch (error) {
    const notFound = error instanceof PublicInstagramError && error.reason === "not_found";
    return { status: notFound ? "not_found" : "failed", profile: null, posts: null, stats: null, fetched_at: null,
      error: error instanceof PublicInstagramError ? error.message : "Instagram nuk u lexua." };
  }
}

/** Hands the read to the scan worker so the reply never waits for Apify. */
export async function wakeProspectScan(id: string, origin: string | null, fetcher: typeof fetch = fetch) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !origin) return false;
  try {
    const url = new URL("/api/cron/prospect-scans", origin);
    url.searchParams.set("scan", id);
    const response = await fetcher(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch { return false; }
}

/** Waits briefly for a scan that is being read, so a fast read answers at once. */
export async function waitForProspectScan(id: string, until: number, db: Db = createServiceSupabase(), sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  let last: ProspectScan | null = null;
  while (Date.now() < until) {
    const { data } = await db.from("prospect_scans").select(columns).eq("id", id).maybeSingle();
    last = (data as ProspectScan | null) ?? last;
    if (last && !["queued", "running"].includes(last.status)) return last;
    await sleep(1500);
  }
  return last;
}

/** Due scans whose wake-up was lost, and expired reads removed. Daily cron. */
export async function runDueProspectScans(limit = 5, db: Db = createServiceSupabase()) {
  await db.from("prospect_scans").delete().lt("expires_at", new Date().toISOString());
  const { data } = await db.from("prospect_scans").select("id").in("status", ["queued", "running"]).lt("attempts", 3)
    .lt("updated_at", new Date(Date.now() - 3 * 60_000).toISOString()).order("updated_at").limit(limit);
  let processed = 0;
  for (const row of data ?? []) if (await runProspectScan(row.id, { db })) processed++;
  return processed;
}

/** What the agent may use and offer. Labels of modules a new business can turn on. */
export function platformModuleCatalog() {
  const offered = ["products", "services", "orders", "bookings", "calendar", "catalogs", "leads", "customers", "knowledge", "workflows", "channels", "reports"] as const;
  return offered.flatMap(id => {
    const entry = (moduleRegistry as Record<string, { label: string; description: string } | undefined>)[id];
    return entry ? [{ id, label: entry.label, description: entry.description }] : [];
  });
}

/** The reply context: only public profile data, the post captions, and status. */
export function prospectReplyContext(request: ScanRequest | null, scan: ProspectScan | null) {
  if (!request) return undefined;
  if (request.kind === "refused" && request.reason === "already_registered") return { username: request.username, status: "not_read",
    guidance: "Ky profil nuk lexohet. Mos thuaj nëse llogaria është apo jo në Agjenti dhe mos krijo ftesë për të. Thuaj shkurt: nëse e keni tashmë llogari, hyni te agjenti.app; përndryshe tregoni pak për biznesin që t'ju them si mund t'ju ndihmojmë." };
  if (request.kind === "refused") return { username: request.username, status: request.reason === "unavailable" ? "unavailable" : "limit_reached",
    guidance: "Leximi i profilit nuk u bë tani. Mos thuaj se e pe profilin; pyet çfarë ofron biznesi." };
  const current = scan ?? request.scan;
  const base = { username: current.username, status: current.status === "running" ? "queued" : current.status,
    // The invitation for this account was already created in this chat.
    ...(current.target_business_id ? { invitationCreated: true, invitationGuidance: "Ftesa për këtë biznes është krijuar tashmë në këtë bisedë. Mos premto ftesë të re; nëse e kërkon, thuaj që do ta ridërgojë stafi." } : {}) };
  if (current.status !== "ready") return { ...base, modules: platformModuleCatalog(),
    guidance: current.status === "queued" || current.status === "running" ? "Profili po lexohet. Thuaj shkurt që po e shikon profilin dhe do t'i japësh propozimin pas pak; ndërkohë mund të pyesësh për biznesin."
      : current.status === "not_found" ? "Llogaria nuk u gjet ose nuk është publike. Kërko username-in e saktë ose pyet çfarë ofron biznesi."
      : "Profili nuk u lexua. Pyet çfarë ofron biznesi." };
  if (emptyPublicProfile(current)) return { ...base, status: "empty", modules: platformModuleCatalog(),
    guidance: "Profili është publik por nuk ka ende postime ose përshkrim. Mos hamendëso çfarë shet biznesi; pyet shkurt çfarë ofron dhe si i marrin klientët porositë ose rezervimet." };
  return { ...base, modules: platformModuleCatalog(),
    profile: { name: current.profile?.name, username: current.profile?.username ?? current.username, biography: current.profile?.biography, website: current.profile?.website },
    stats: current.stats ?? undefined,
    recentPosts: (current.posts ?? []).slice(0, 5).map(post => ({ type: post.mediaType, caption: post.caption?.slice(0, 600) ?? "" })),
    guidance: "Përdor vetëm këto të dhëna publike për të shpjeguar konkretisht cilat module të Agjenti.app i shërbejnë këtij biznesi. Mos shpik çmime, numra ose rezultate." };
}

/** The customer did not name their own account: unless it was read with something
 * on it, the reply never mentions the read and simply goes on by asking. */
export function senderReplyContext(context: ReturnType<typeof prospectReplyContext>, fromSender: boolean) {
  if (!fromSender || !context || ["ready", "empty"].includes(String(context.status))) return context;
  return { username: context.username, status: "manual",
    ...("invitationCreated" in context ? { invitationCreated: context.invitationCreated, invitationGuidance: context.invitationGuidance } : {}),
    guidance: "Nuk ka të dhëna të mjaftueshme nga profili publik i Instagram-it të klientit. Mos e përmend leximin; vazhdo normalisht me pyetje për llojin e biznesit dhe nevojën kryesore." };
}

/** The latest read account of the chat, for the invitation that follows. */
export async function readyProspectScan(businessId: string, conversationId: string, db: Db = createServiceSupabase()) {
  const { data } = await db.from("prospect_scans").select(columns).eq("business_id", businessId).eq("conversation_id", conversationId)
    .eq("status", "ready").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ProspectScan | null) ?? null;
}

/** Links the chat's read account to the business prepared for the prospect.
 * The invitation shows it; the owner's own onboarding reads it for review. */
export async function attachProspectScanToInvitation(p: { businessId: string; conversationId: string; targetBusinessId: string }, db: Db = createServiceSupabase()) {
  const scan = await readyProspectScan(p.businessId, p.conversationId, db);
  if (!scan || emptyPublicProfile(scan) || await connectedToAnotherBusiness(scan.username, p.targetBusinessId, db)) return false;
  const invitation = await db.from("business_invitations").select("id,details,status").eq("source_business_id", p.businessId)
    .eq("target_business_id", p.targetBusinessId).maybeSingle();
  if (invitation.error || !invitation.data || invitation.data.status !== "pending") return false;
  const details = { ...(invitation.data.details as Record<string, unknown> ?? {}), instagramUsername: scan.username };
  const [linked, saved] = await Promise.all([
    db.from("business_invitations").update({ details }).eq("id", invitation.data.id).eq("status", "pending"),
    db.from("prospect_scans").update({ target_business_id: p.targetBusinessId, updated_at: new Date().toISOString() }).eq("id", scan.id),
  ]);
  return !linked.error && !saved.error;
}

/** After the owner accepts: the username is saved and a review scan starts. The
 * fresh read is handed to the analysis so it is not paid twice. Nothing is
 * applied before the owner confirms the review. */
export async function prefillAcceptedBusiness(targetBusinessId: string, userId: string, deps: {
  db?: Db; saveUsername?: (businessId: string, userId: string, raw: unknown) => Promise<unknown>;
} = {}) {
  const db = deps.db ?? createServiceSupabase();
  const invitation = await db.from("business_invitations").select("source_business_id,details,status,accepted_by")
    .eq("target_business_id", targetBusinessId).maybeSingle();
  const username = normalizeInstagramUsername((invitation.data?.details as { instagramUsername?: unknown } | null)?.instagramUsername);
  if (invitation.error || !invitation.data || invitation.data.status !== "accepted" || invitation.data.accepted_by !== userId || !username) return false;
  const scan = await db.from("prospect_scans").select(columns).eq("business_id", invitation.data.source_business_id)
    .eq("target_business_id", targetBusinessId).eq("username", username).eq("status", "ready").maybeSingle();
  const read = scan.data as ProspectScan | null;
  if (read?.profile && Array.isArray(read.posts) && read.fetched_at)
    await db.from("business_source_previews").upsert({ business_id: targetBusinessId,
      instagram: { username, fetchedAt: read.fetched_at, profile: read.profile, posts: read.posts, stats: read.stats ?? undefined }, updated_at: new Date().toISOString() },
    { onConflict: "business_id" });
  const save = deps.saveUsername ?? (await import("@/lib/discovery/instagram-username")).saveInstagramUsername;
  await save(targetBusinessId, userId, username);
  return true;
}
