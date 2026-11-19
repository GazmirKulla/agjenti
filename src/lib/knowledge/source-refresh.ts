import { after } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { continueDiscovery } from "@/lib/discovery/continue";
import { enqueueDiscovery, enqueuePublicInstagram, enqueueWebsiteReview } from "@/lib/discovery/queue";

export type SourceRefresh = { website: string | null; instagram: string | null };

/** The sources the business confirmed: its website and its Instagram (connected, or the public username). */
export async function businessSources(businessId: string): Promise<SourceRefresh & { connectedInstagram: boolean }> {
  const db = createServiceSupabase();
  const [business, preview, site, connection] = await Promise.all([
    db.from("businesses").select("instagram_username").eq("id", businessId).maybeSingle(),
    db.from("business_source_previews").select("website").eq("business_id", businessId).maybeSingle(),
    db.from("business_discovery_jobs").select("input").eq("business_id", businessId).eq("source", "website").eq("status", "completed")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("instagram_connections").select("id").eq("business_id", businessId).eq("status", "connected").maybeSingle(),
  ]);
  if (business.error || site.error || connection.error) throw new Error("Burimet nuk u lexuan.");
  const confirmed = (preview.data?.website as { url?: string; confirmed?: boolean } | null) ?? null;
  const website = (confirmed?.confirmed ? confirmed.url : null) ?? (site.data?.input as { url?: string } | null)?.url ?? null;
  return { website: website ?? null, instagram: business.data?.instagram_username ?? null, connectedInstagram: Boolean(connection.data) };
}

/**
 * Reads the business's sources again. What is new or different comes back as a proposal the owner reviews;
 * an entry the owner wrote or changed is never overwritten (a different text under the same title waits
 * inactive). Returns which sources were queued.
 */
export async function refreshBusinessSources(businessId: string, userId: string, origin: string | null): Promise<SourceRefresh> {
  const sources = await businessSources(businessId);
  const queued: SourceRefresh = { website: null, instagram: null };
  // Each source on its own: one that cannot be read again (e.g. a public profile read once) never stops the other.
  if (sources.website) { try { await enqueueWebsiteReview(businessId, userId, sources.website); queued.website = sources.website; } catch { /* reported as not queued */ } }
  try {
    if (sources.connectedInstagram) { await enqueueDiscovery(businessId, userId, "instagram", undefined, true, { review: true }); queued.instagram = sources.instagram ?? "Instagram"; }
    else if (sources.instagram) { await enqueuePublicInstagram(businessId, userId, sources.instagram, true, { review: true }); queued.instagram = sources.instagram; }
  } catch { /* reported as not queued */ }
  if (queued.website || queued.instagram) {
    try { after(() => continueDiscovery(businessId, origin)); } catch { void continueDiscovery(businessId, origin); }
  }
  return queued;
}

