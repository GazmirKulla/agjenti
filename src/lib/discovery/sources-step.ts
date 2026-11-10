import { createServiceSupabase } from "@/lib/supabase/service";
import { fetchPublicInstagram, normalizeInstagramUsername, PublicInstagramError, PUBLIC_POST_LIMIT, publicScanAvailable } from "@/lib/instagram/public-profile";
import { fetchPublicPage } from "@/lib/products/import-url";
import { enqueueDiscovery, enqueuePublicInstagram } from "./queue";
import { normalizeWebsite } from "./onboarding-sources";
import { jobProgress } from "./review";

/** Onboarding step 2, "Where the agent learns from":
 *  1. preview: the public Instagram profile and the website's first page, shown
 *     to the owner at once; the general description is saved as "Rreth biznesit".
 *  2. learn: after the owner agrees, the last PUBLIC_POST_LIMIT posts and the
 *     website's first page are analysed in the background.
 *  3. review: what the analysis found waits as a proposal the owner confirms. */

// Each source read counts; the owner may correct a typo a few times.
const MAX_PREVIEWS = 12;
const ABOUT_TITLE = "Rreth biznesit";

export type InstagramPreview = { username: string; name?: string; biography?: string; website?: string; postCount: number } | { username: string; error: string };
export type WebsitePreview = { url: string; title?: string; description?: string } | { url: string; error: string };
export type SourcesPreview = { instagram: InstagramPreview | null; website: WebsitePreview | null; about: string | null };

type StoredInstagram = { username: string; fetchedAt: string; profile: Record<string, string>; posts: unknown[] };

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

/** Title and description of a page, without AI. */
export function pageSummary(html: string) {
  const title = meta(html, "og:site_name") ?? meta(html, "og:title") ?? decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200);
  const description = meta(html, "description") ?? meta(html, "og:description");
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
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
  const { data: saved } = await db.from("business_source_previews").select("instagram,website,about_knowledge_id,fetch_count").eq("business_id", businessId).maybeSingle();
  if ((saved?.fetch_count ?? 0) >= MAX_PREVIEWS) throw new SourcesError("Ke provuar shumë herë. Vazhdo te paneli dhe shtoji më vonë te Njohuritë.", 429);
  const previous = saved?.instagram as StoredInstagram | null;
  const previousSite = saved?.website as { url?: string; title?: string; description?: string } | null;

  let instagram: InstagramPreview | null = null;
  let stored: StoredInstagram | null = null;
  if (readInstagram && username) {
    if (await usernameScanUsed(businessId)) instagram = { username, error: "Instagram-i i këtij biznesi është analizuar tashmë." };
    else if (!publicScanAvailable()) instagram = { username, error: "Leximi i Instagram-it nuk është aktiv ende. Username u ruajt dhe do të lexohet më vonë." };
    else try {
      const fresh = previous?.username === username && !!previous.profile && Date.now() - new Date(previous.fetchedAt).getTime() < 6 * 3600_000;
      const read = fresh ? { profile: previous!.profile, posts: previous!.posts } : await fetchPublicInstagram(username);
      stored = { username, fetchedAt: fresh ? previous!.fetchedAt : new Date().toISOString(), profile: read.profile as Record<string, string>, posts: (read.posts as unknown[]).slice(0, PUBLIC_POST_LIMIT) };
      instagram = { username, name: stored.profile.name, biography: stored.profile.biography, website: stored.profile.website, postCount: stored.posts.length };
    } catch (error) {
      instagram = { username, error: error instanceof PublicInstagramError ? error.message : "Instagram nuk u lexua. Provo përsëri më vonë." };
    }
  }

  let website: WebsitePreview | null = null;
  if (readWebsite && url) {
    const page = await fetchPublicPage(url).catch(() => ({ error: "Website nuk u hap." }));
    website = "error" in page ? { url, error: "Website nuk u hap. Kontrollo adresën." } : { url: page.url, ...pageSummary(page.body) };
  }

  // What the other source gave earlier in this step still counts for "Rreth biznesit".
  const keptInstagram: InstagramPreview | null = !readInstagram && username && previous?.username === username && previous.profile
    ? { username, name: previous.profile.name, biography: previous.profile.biography, website: previous.profile.website, postCount: previous.posts?.length ?? 0 } : null;
  const keptWebsite: WebsitePreview | null = !readWebsite && url && previousSite?.url ? { url: previousSite.url, title: previousSite.title, description: previousSite.description } : null;

  // The general description is saved at once, as agreed: it only states what
  // the business itself publishes about itself.
  const about = aboutText(instagram ?? keptInstagram, website ?? keptWebsite);
  let aboutId: string | null = saved?.about_knowledge_id ?? null;
  if (about) {
    const updated = aboutId ? await db.from("knowledge_entries").update({ body: about, updated_at: new Date().toISOString() }).eq("id", aboutId).eq("business_id", businessId).select("id").maybeSingle() : null;
    if (!updated?.data) {
      const { data: created } = await db.from("knowledge_entries").insert({ business_id: businessId, title: ABOUT_TITLE, body: about, is_active: true }).select("id").single();
      aboutId = created?.id ?? null;
    }
  }
  const row: Record<string, unknown> = { business_id: businessId, about_knowledge_id: aboutId, fetch_count: (saved?.fetch_count ?? 0) + 1, updated_at: new Date().toISOString() };
  if (readInstagram) row.instagram = stored ?? { username };
  else if (!username) row.instagram = null;
  if (readWebsite) row.website = website && !("error" in website) ? website : { url };
  else if (!url) row.website = null;
  const { error } = await db.from("business_source_previews").upsert(row);
  if (error) throw new SourcesError("Të dhënat nuk u ruajtën. Provo përsëri.");
  if (readInstagram && username) await db.from("businesses").update({ instagram_username: username }).eq("id", businessId);
  return { instagram, website, about };
}

/** The owner agreed: read the last posts and the website's first page. */
export async function learnFromSources(businessId: string, userId: string) {
  const db = createServiceSupabase();
  const { data } = await db.from("business_source_previews").select("instagram,website").eq("business_id", businessId).maybeSingle();
  const instagram = data?.instagram as Partial<StoredInstagram> | null;
  const website = data?.website as { url?: string } | null;
  let started = 0;
  if (instagram?.username && instagram.profile && publicScanAvailable() && !(await usernameScanUsed(businessId))) {
    await enqueuePublicInstagram(businessId, userId, instagram.username, false, { review: true }).then(() => started++).catch(() => null);
  }
  if (website?.url) {
    await enqueueDiscovery(businessId, userId, "website", website.url, true, { review: true, pages: 1 }).then(() => started++).catch(() => null);
  }
  if (!started) throw new SourcesError("Nuk ka asgjë për të analizuar. Vazhdo te paneli.", 409);
  return started;
}

export type ProposedKnowledge = { id: string; title: string; body: string };
export type SourcesState = {
  preview: { instagram: { username: string; name?: string; biography?: string; website?: string } | null; website: { url: string; title?: string; description?: string } | null };
  /** Each source's analysis: how far it is (0–100) and what it is doing now. */
  scans: { source: "instagram" | "website"; status: string; error: string | null; progress: number; step: string }[];
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
    db.from("business_discovery_jobs").select("source,status,stage,error,input,checkpoint,created_at").eq("business_id", businessId)
      .order("created_at", { ascending: false }).limit(12),
  ]);
  const ig = saved?.instagram as Partial<StoredInstagram> | null;
  const site = saved?.website as { url: string; title?: string; description?: string } | null;
  const reviewJobs = (jobs ?? []).filter((job) => job.input?.review);
  const latest = (["instagram", "website"] as const).flatMap((source) => {
    const job = reviewJobs.find((item) => item.source === source);
    return job ? [{ source, status: job.status as string, error: job.status === "failed" ? (job.error as string | null) : null, ...scanProgress(job) }] : [];
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

/** keep: the proposed entries to publish; null dismisses the whole proposal. */
export async function reviewSources(businessId: string, userId: string, keep: unknown) {
  if (keep !== null && (!Array.isArray(keep) || keep.length > 200 || keep.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))))
    throw new SourcesError("Zgjedhja nuk është e vlefshme.");
  const { data, error } = await createServiceSupabase().rpc("review_discovery", { p_business: businessId, p_user: userId, p_keep: keep });
  if (error) throw new SourcesError(error.message === "unauthorized" ? "Nuk ke qasje në këtë biznes." : "Konfirmimi nuk u ruajt. Provo përsëri.");
  return data as { kept: number; removed: number };
}
