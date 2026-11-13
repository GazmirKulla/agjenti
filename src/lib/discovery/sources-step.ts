import { createServiceSupabase } from "@/lib/supabase/service";
import { fetchPublicInstagram, normalizeInstagramUsername, PublicInstagramError, PUBLIC_POST_LIMIT, publicScanAvailable } from "@/lib/instagram/public-profile";
import { fetchPublicPage } from "@/lib/products/import-url";
import { enqueuePublicInstagram, enqueueWebsiteReview } from "./queue";
import { connectedToAnotherBusiness, CONNECTED_ELSEWHERE_MESSAGE, EMPTY_PROFILE_MESSAGE, emptyPublicProfile, recentPublicRead } from "@/lib/instagram/account-rules";
import { normalizeWebsite } from "./onboarding-sources";
import { jobProgress } from "./review";
import { discoveryPreviews } from "./previews";
import type { ScanJob } from "@/components/setup/scan-dialog";

/** Onboarding step 2, "Where the agent learns from":
 *  1. preview: the public Instagram profile and the website's first page, shown
 *     to the owner at once; the general description is saved as "Rreth biznesit".
 *  2. learn: after the owner agrees, the last PUBLIC_POST_LIMIT posts and the
 *     website's first page are analysed in the background.
 *  3. review: what the analysis found waits as a proposal the owner confirms. */

// Each source read counts; the owner may correct a typo a few times.
const MAX_PREVIEWS = 12;

export type InstagramPreview = { username: string; name?: string; biography?: string; website?: string; postCount: number;
  /** For the owner to recognise the account: photo and numbers. */
  picture?: string; followers?: number; posts?: number } | { username: string; error: string };
export type WebsitePreview = { url: string; title?: string; description?: string; logo?: string } | { url: string; error: string };
export type SourcesPreview = { instagram: InstagramPreview | null; website: WebsitePreview | null; about: string | null };

type StoredInstagram = { username: string; fetchedAt: string; profile: Record<string, string>; posts: unknown[];
  stats?: { followers?: number; posts?: number }; confirmed?: boolean };
type StoredWebsite = { url: string; title?: string; description?: string; logo?: string; confirmed?: boolean };

export class SourcesError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 429 = 400) { super(message); }
}

function decode(text: string) {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
}
function meta(html: string, key: string) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i"))?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).slice(0, 500) : undefined;
}

/** The site's logo: its touch icon, else its icon, else its share image. */
export function pageLogo(html: string, base: string) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const href = (rel: RegExp) => links.find((tag) => rel.test(tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? ""))?.match(/href=["']([^"']+)["']/i)?.[1];
  const raw = href(/apple-touch-icon/i) ?? href(/(^|\s)icon(\s|$)/i) ?? meta(html, "og:image");
  if (!raw) return undefined;
  try {
    const url = new URL(decode(raw), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 2000) : undefined;
  } catch { return undefined; }
}

/** Title, description and logo of a page, without AI. */
export function pageSummary(html: string, base?: string) {
  const title = meta(html, "og:site_name") ?? meta(html, "og:title") ?? decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200);
  const description = meta(html, "description") ?? meta(html, "og:description");
  const logo = base ? pageLogo(html, base) : undefined;
  return { ...(title ? { title } : {}), ...(description ? { description } : {}), ...(logo ? { logo } : {}) };
}

/** The general text saved as "Rreth biznesit": the bio and the site's description. */
export function aboutText(instagram: InstagramPreview | null, website: WebsitePreview | null) {
  const parts: string[] = [];
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
  let site: string | null = null;
  if (instagram && !("error" in instagram)) {
    if (instagram.biography) parts.push(instagram.biography);
    if (instagram.website) site = instagram.website;
  }
  if (website && !("error" in website)) {
    if (website.description && !parts.some((part) => part.includes(website.description!))) parts.push(website.description);
    // One address per site: the one the owner typed wins over the profile's link.
    if (!site || host(site) === host(website.url)) site = website.url;
    else parts.push(`Website: ${website.url}`);
  }
  if (site) parts.push(`Website: ${site}`);
  if (instagram && !("error" in instagram)) parts.push(`Instagram: @${instagram.username}`);
  const text = parts.join("\n").trim();
  return text.length >= 10 ? text.slice(0, 4000) : null;
}

async function usernameScanUsed(businessId: string) {
  const { data } = await createServiceSupabase().from("business_discovery_jobs").select("id")
    .eq("business_id", businessId).eq("source", "instagram").not("input->>username", "is", null)
    .in("status", ["queued", "running", "completed"]).limit(1).maybeSingle();
  return Boolean(data);
}

/** Reads the public Instagram and/or the website's first page. With `only`, a
 * single source is read now (the screen shows each one's progress) while the
 * other keeps what was read before, or is cleared when the owner left it empty. */
export async function previewSources(businessId: string, raw: { username?: unknown; website?: unknown; only?: unknown }): Promise<SourcesPreview> {
  const rawUsername = typeof raw.username === "string" ? raw.username.trim() : "";
  const rawWebsite = typeof raw.website === "string" ? raw.website.trim() : "";
  const username = rawUsername ? normalizeInstagramUsername(rawUsername) : null;
  const url = rawWebsite ? normalizeWebsite(rawWebsite) : null;
  if (rawUsername && !username) throw new SourcesError("Shkruaj një username të vlefshëm Instagram-i, p.sh. @dyqani.im");
  if (rawWebsite && !url) throw new SourcesError("Shkruaj një website të vlefshëm, p.sh. zana.al");
  if (!username && !url) throw new SourcesError("Shkruaj Instagram-in ose website-in, ose anashkalo hapin.");
  const readInstagram = raw.only !== "website" && !!username;
  const readWebsite = raw.only !== "instagram" && !!url;
  const db = createServiceSupabase();
  const { data: saved } = await db.from("business_source_previews").select("instagram,fetch_count").eq("business_id", businessId).maybeSingle();
  if ((saved?.fetch_count ?? 0) >= MAX_PREVIEWS) throw new SourcesError("Ke provuar shumë herë. Vazhdo te paneli dhe shtoji më vonë te Njohuritë.", 429);
  const previous = saved?.instagram as StoredInstagram | null;

  let instagram: InstagramPreview | null = null;
  let stored: StoredInstagram | null = null;
  let blocked = false;
  if (readInstagram && username) {
    if (await connectedToAnotherBusiness(username, businessId)) { blocked = true; instagram = { username, error: CONNECTED_ELSEWHERE_MESSAGE }; }
    else if (await usernameScanUsed(businessId)) instagram = { username, error: "Instagram-i i këtij biznesi është analizuar tashmë." };
    else if (!publicScanAvailable()) instagram = { username, error: "Leximi i Instagram-it nuk është aktiv ende. Username u ruajt dhe do të lexohet më vonë." };
    else try {
      const fresh = previous?.username === username && !!previous.profile && Date.now() - new Date(previous.fetchedAt).getTime() < 6 * 3600_000;
      // The same account read in the last hours (an Agjenti.app chat, another preview) is not paid twice.
      const shared = fresh ? null : await recentPublicRead(username).catch(() => null);
      const read = fresh ? { profile: previous!.profile, posts: previous!.posts, stats: previous!.stats } : shared ?? await fetchPublicInstagram(username);
      const candidate: StoredInstagram = { username, fetchedAt: fresh ? previous!.fetchedAt : shared?.fetchedAt ?? new Date().toISOString(), profile: read.profile as Record<string, string>,
        posts: (read.posts as unknown[]).slice(0, PUBLIC_POST_LIMIT), stats: read.stats };
      if (emptyPublicProfile({ profile: candidate.profile, posts: candidate.posts })) instagram = { username, error: EMPTY_PROFILE_MESSAGE };
      else {
        stored = candidate;
        instagram = { username, name: stored.profile.name, biography: stored.profile.biography, website: stored.profile.website, postCount: stored.posts.length,
          picture: stored.profile.profile_picture_url, followers: stored.stats?.followers, posts: stored.stats?.posts };
      }
    } catch (error) {
      instagram = { username, error: error instanceof PublicInstagramError ? error.message : "Instagram nuk u lexua. Provo përsëri më vonë." };
    }
  }

  let website: WebsitePreview | null = null;
  if (readWebsite && url) {
    const page = await fetchPublicPage(url).catch(() => ({ error: "Website nuk u hap." }));
    website = "error" in page ? { url, error: "Website nuk u hap. Kontrollo adresën." } : { url: page.url, ...pageSummary(page.body, page.url) };
  }

  // Nothing is saved as knowledge yet: the owner first confirms these are their
  // own accounts; the description joins the analysis after that.
  const about = aboutText(instagram, website);
  const row: Record<string, unknown> = { business_id: businessId, fetch_count: (saved?.fetch_count ?? 0) + 1, updated_at: new Date().toISOString() };
  if (readInstagram) row.instagram = stored ?? { username };
  else if (!username) row.instagram = null;
  if (readWebsite) row.website = website && !("error" in website) ? website : { url };
  else if (!url) row.website = null;
  const { error } = await db.from("business_source_previews").upsert(row);
  if (error) throw new SourcesError("Të dhënat nuk u ruajtën. Provo përsëri.");
  // An account another business connected with Instagram login is not saved as this one's.
  if (readInstagram && username && !blocked) await db.from("businesses").update({ instagram_username: username }).eq("id", businessId);
  return { instagram, website, about };
}

/** The owner confirmed which accounts are theirs: Instagram is read first
 * (the last posts), then the website (home, about and contact pages). */
export async function learnFromSources(businessId: string, userId: string, confirmed: { instagram?: unknown; website?: unknown }) {
  const db = createServiceSupabase();
  const { data } = await db.from("business_source_previews").select("instagram,website").eq("business_id", businessId).maybeSingle();
  const instagram = data?.instagram as Partial<StoredInstagram> | null;
  const website = data?.website as StoredWebsite | null;
  const readInstagram = confirmed.instagram === true && !!instagram?.username && !!instagram.profile && publicScanAvailable() && !(await usernameScanUsed(businessId))
    && !emptyPublicProfile({ profile: instagram.profile, posts: instagram.posts }) && !(await connectedToAnotherBusiness(instagram.username!, businessId));
  const readWebsite = confirmed.website === true && !!website?.url;
  if (!readInstagram && !readWebsite) throw new SourcesError("Konfirmo të paktën një llogari, ose vazhdo pa analizë.", 409);
  await db.from("business_source_previews").update({
    instagram: instagram ? { ...instagram, confirmed: readInstagram } : null,
    website: website ? { ...website, confirmed: readWebsite } : null,
    updated_at: new Date().toISOString(),
  }).eq("business_id", businessId);
  if (readInstagram) {
    // The website follows when Instagram is done (see the review finish in the queue).
    await enqueuePublicInstagram(businessId, userId, instagram!.username!, false, { review: true });
  } else if (website?.url) {
    await enqueueWebsiteReview(businessId, userId, website.url);
  }
  return { instagram: readInstagram, website: readWebsite };
}

export type ProposedKnowledge = { id: string; title: string; body: string };
export type SourcesState = {
  preview: { instagram: { username: string; name?: string; biography?: string; website?: string } | null; website: { url: string; title?: string; description?: string } | null };
  /** Each source's analysis: how far it is (0–100), what it is doing now and
   * what it shows (the posts' photos, the website's pages). */
  scans: (ScanJob & { step: string })[];
  review: { knowledge: ProposedKnowledge[]; changesAgent: boolean; changesPanel: boolean; changesProcess: boolean } | null;
};

type ReviewCheckpoint = { status?: string; knowledgeIds?: string[]; profile?: unknown; agent?: unknown; process?: unknown };

type ScanRow = { source: string; status: string; stage?: string; checkpoint?: { images?: unknown[]; nextImage?: number; text?: string; nextText?: number } | null };

/** A plain description of where a scan is, for the progress bar. */
export function scanProgress(job: ScanRow): { progress: number; step: string } {
  if (job.status === "completed") return { progress: 100, step: "Gati" };
  if (job.status === "failed") return { progress: 100, step: "Nuk përfundoi" };
  const checkpoint = job.checkpoint ?? {};
  const images = checkpoint.images?.length ?? 0, done = Math.min(images, checkpoint.nextImage ?? 0);
  const progress = jobProgress(job.stage ?? "capture", done, images, checkpoint.nextText ?? 0, checkpoint.text?.length ?? 0);
  const instagram = job.source === "instagram";
  const step = job.stage === "text" ? (instagram ? "Po lexohen përshkrimet e postimeve" : "Po lexohet teksti i faqes")
    : job.stage === "images" ? `Po shihen fotot (${done} nga ${images})`
    : job.stage === "finish" ? "Po përgatitet propozimi"
    : job.status === "queued" && (job.stage ?? "capture") === "capture" ? "Në radhë"
    : instagram ? "Po merren postimet" : "Po hapet faqja";
  return { progress, step };
}

export async function sourcesState(businessId: string): Promise<SourcesState> {
  const db = createServiceSupabase();
  const [{ data: saved }, { data: jobs }] = await Promise.all([
    db.from("business_source_previews").select("instagram,website").eq("business_id", businessId).maybeSingle(),
    db.from("business_discovery_jobs").select("id,source,status,stage,error,input,checkpoint,created_at").eq("business_id", businessId)
      .order("created_at", { ascending: false }).limit(12),
  ]);
  const ig = saved?.instagram as Partial<StoredInstagram> | null;
  const site = saved?.website as { url: string; title?: string; description?: string } | null;
  const reviewJobs = (jobs ?? []).filter((job) => job.input?.review);
  const latest = (["instagram", "website"] as const).flatMap((source): (ScanJob & { step: string })[] => {
    const job = reviewJobs.find((item) => item.source === source);
    if (!job) {
      // The confirmed website waits for Instagram to finish.
      const waiting = source === "website" && (saved?.website as StoredWebsite | null)?.confirmed && reviewJobs.some((item) => item.source === "instagram");
      return waiting ? [{ id: "website-waiting", source, status: "queued", stage: "capture", progress: 0, error: null, postCount: 0, imageCount: 0, previews: [], pageCount: 0, step: "Pas Instagram-it" }] : [];
    }
    const checkpoint = job.checkpoint ?? {};
    return [{ id: job.id as string, source, status: job.status as string, stage: job.stage as string, error: job.status === "failed" ? (job.error as string | null) : null,
      postCount: checkpoint.postCount ?? 0, imageCount: checkpoint.images?.length ?? 0, nextImage: checkpoint.nextImage ?? 0,
      previews: discoveryPreviews(source, checkpoint), pageCount: checkpoint.pageCount ?? 0, ...scanProgress(job) }];
  });
  const pending = reviewJobs.filter((job) => job.status === "completed" && (job.checkpoint?.review as ReviewCheckpoint | undefined)?.status === "pending");
  const ids = [...new Set(pending.flatMap((job) => (job.checkpoint.review as ReviewCheckpoint).knowledgeIds ?? []))];
  let knowledge: ProposedKnowledge[] = [];
  if (ids.length) {
    const { data } = await db.from("knowledge_entries").select("id,title,body").eq("business_id", businessId).eq("is_active", false).in("id", ids).order("created_at");
    knowledge = (data ?? []).map((row) => ({ id: row.id, title: row.title, body: row.body }));
  }
  const reviews = pending.map((job) => job.checkpoint.review as ReviewCheckpoint);
  return {
    preview: {
      instagram: ig?.username ? { username: ig.username, name: ig.profile?.name, biography: ig.profile?.biography, website: ig.profile?.website } : null,
      website: site?.url ? site : null,
    },
    scans: latest,
    review: pending.length ? {
      knowledge,
      changesAgent: reviews.some((r) => r.agent && typeof r.agent === "object"),
      changesPanel: reviews.some((r) => r.profile && typeof r.profile === "object"),
      changesProcess: reviews.some((r) => r.process && typeof r.process === "object"),
    } : null,
  };
}

export type KnowledgeEdit = { id: string; title: string; body: string };

/** Owner's edits to proposed entries, checked before anything is written. */
export function parseEdits(raw: unknown): KnowledgeEdit[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 60) throw new SourcesError("Ndryshimet nuk janë të vlefshme.");
  return raw.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = typeof row.id === "string" ? row.id : "", title = typeof row.title === "string" ? row.title.trim() : "", body = typeof row.body === "string" ? row.body.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || title.length < 2 || title.length > 500 || body.length < 2 || body.length > 8000)
      throw new SourcesError("Çdo njohuri duhet të ketë titull dhe tekst.");
    return { id, title, body };
  });
}

/** keep: the proposed entries to publish (with the owner's edits); null dismisses the whole proposal. */
export async function reviewSources(businessId: string, userId: string, keep: unknown, edits: unknown = []) {
  if (keep !== null && (!Array.isArray(keep) || keep.length > 200 || keep.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))))
    throw new SourcesError("Zgjedhja nuk është e vlefshme.");
  const changes = keep === null ? [] : parseEdits(edits).filter((edit) => (keep as string[]).includes(edit.id));
  const db = createServiceSupabase();
  // Only entries still waiting in this business's proposal can be edited here.
  for (const edit of changes) {
    const { error } = await db.from("knowledge_entries").update({ title: edit.title, body: edit.body, updated_at: new Date().toISOString() })
      .eq("id", edit.id).eq("business_id", businessId).eq("is_active", false);
    if (error) throw new SourcesError("Ndryshimet nuk u ruajtën. Provo përsëri.");
  }
  const { data, error } = await db.rpc("review_discovery", { p_business: businessId, p_user: userId, p_keep: keep });
  if (error) throw new SourcesError(error.message === "unauthorized" ? "Nuk ke qasje në këtë biznes." : "Konfirmimi nuk u ruajt. Provo përsëri.");
  return data as { kept: number; removed: number };
}
