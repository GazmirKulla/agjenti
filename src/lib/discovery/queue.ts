import { createServiceSupabase } from "@/lib/supabase/service";
import { extractInstagram, extractWebsite } from "@/lib/business-intelligence/ingestion";
import { normalizeSource } from "@/lib/business-intelligence/normalization";
import { emptyDraft, mergeDraft, type Entity, type Draft } from "@/lib/business-intelligence/model";
import { classifyBusiness, meaningfulEntities, mergedReview, withSetupRecommendations } from "./proposal";
import { scanKnowledge, withoutScanKnowledge } from "@/lib/business-intelligence/scan-routing";
import { IMAGE_BATCH_SIZE, type DiscoveryImage } from "./images";

type Checkpoint = {
  text?: string; reference?: string; note?: string; website?: string | null;
  postCount?: number; images?: DiscoveryImage[]; entities?: Entity[];
  nextImage?: number; warnings?: string[];
  draft?: Draft;
};
type Job = {
  id: string; business_id: string; source: "instagram" | "website";
  input: { url?: string; connectionId?: string; generation?: string };
  stage: string; checkpoint: Checkpoint; lease_token: string;
  attempts: number;
};

export async function enqueueDiscovery(businessId: string, userId: string, source: "instagram" | "website", website?: string, force = false) {
  const db = createServiceSupabase();
  let input: Job["input"];
  if (source === "instagram") {
    const { data, error } = await db.from("instagram_connections").select("id,discovery_generation").eq("business_id", businessId).eq("status", "connected").maybeSingle();
    if (error || !data) throw new Error("Lidh Instagram-in përpara analizës.");
    input = { connectionId: data.id, generation: data.discovery_generation };
  } else {
    const url = new URL(website?.trim() ?? "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 2000) throw new Error("Vendos një website të vlefshëm.");
    url.hash = "";
    input = { url: url.href };
  }
  const { data, error } = await db.rpc("enqueue_business_discovery", { p_business: businessId, p_user: userId, p_source: source, p_input: input, p_force: force });
  if (error) throw new Error(error.message);
  return data as string;
}

async function validConnection(job: Job) {
  if (job.source !== "instagram") return;
  const db = createServiceSupabase();
  const { data, error } = await db.from("instagram_connections").select("id").eq("id", job.input.connectionId!).eq("business_id", job.business_id).eq("discovery_generation", job.input.generation!).eq("status", "connected").maybeSingle();
  if (error || !data) throw new Error("connection_changed");
}

async function checkpoint(job: Job, data: Checkpoint, stage: string, error: string | null = null) {
  const result = await createServiceSupabase().rpc("checkpoint_business_discovery", { p_job: job.id, p_lease: job.lease_token, p_checkpoint: data, p_stage: stage, p_error: error });
  if (result.error) throw new Error("checkpoint_failed");
  if (!result.data) throw new Error("lease_expired");
}

export async function processDiscoveryStep(job: Job) {
  const db = createServiceSupabase();
  const data = job.checkpoint;
  await validConnection(job);
  if (job.stage === "capture") {
    const captured = job.source === "instagram" ? await extractInstagram(job.business_id) : await extractWebsite(job.input.url!);
    // Do not persist the decrypted token, fetch Request, or provider errors.
    const ig = job.source === "instagram" ? captured as Awaited<ReturnType<typeof extractInstagram>> : null;
    const next: Checkpoint = { text: captured.text, reference: captured.reference, note: captured.note, entities: [], images: ig?.images ?? [], postCount: ig?.postCount, website: ig?.website ?? null };
    await validConnection(job);
    return checkpoint(job, next, "text");
  }
  if (job.stage === "text") {
    let entities: Entity[] = [];
    try { entities = meaningfulEntities(await normalizeSource(data.text!, job.source, data.reference!, "profile")); }
    catch (error) {
      // Empty captions are common. Images can still provide the first useful facts.
      if (!(error instanceof Error && error.message.startsWith("Nuk u gjetën"))) throw error;
    }
    return checkpoint(job, { ...data, entities }, data.images?.length ? "images" : "finish");
  }
  if (job.stage === "images") {
    const offset = data.nextImage ?? 0;
    const batch = (data.images ?? []).slice(offset, offset + IMAGE_BATCH_SIZE);
    const text = batch.map((image) => `Post: ${image.postUrl ?? image.id}\n${image.caption}\nImage URL: ${image.url}`).join("\n\n");
    const entities = data.entities ?? [];
    let warnings = data.warnings ?? [];
    try {
      const extracted = meaningfulEntities(await normalizeSource(text, "instagram", data.reference!, "profile", batch));
      // Merge conflicts are retained in the source checkpoint and final draft.
      const merged = mergeDraft(data.draft ?? { ...emptyDraft(), entities: data.entities ?? [] }, extracted);
      return checkpoint(job, { ...data, entities: merged.entities, draft: merged, nextImage: offset + batch.length }, offset + batch.length < (data.images?.length ?? 0) ? "images" : "finish");
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith("Nuk u gjetën"))) {
        // Retry provider failures; the successful text/previous images are checkpointed.
        if (job.attempts < 3) throw error;
        warnings = [...warnings, "Një grup fotosh nuk u analizua pas tri provash. Rezultati përfshin tekstet dhe fotot e tjera."];
      }
      warnings = [...warnings, "Disa foto nuk dhanë informacion të përdorshëm."];
    }
    return checkpoint(job, { ...data, entities, warnings, nextImage: offset + batch.length }, offset + batch.length < (data.images?.length ?? 0) ? "images" : "finish");
  }
  if (job.stage !== "finish") throw new Error("invalid_stage");
  const { data: state, error } = await db.from("business_discovery").select("*").eq("business_id", job.business_id).single();
  if (error || !state) throw new Error("discovery_unavailable");
  let draft = mergedReview(state.draft as Draft, data.draft ?? { ...emptyDraft(), entities: data.entities ?? [] });
  const signals = state.signals_source === "manual" && state.signals ? state.signals : await classifyBusiness(draft);
  draft = withSetupRecommendations(draft, signals, state.baseline);
  const knowledge = scanKnowledge(draft);
  draft = withoutScanKnowledge(draft, knowledge);
  await validConnection(job);
  const finished = await db.rpc(knowledge.length ? "finish_scanned_business_discovery" : "finish_business_discovery", { p_job: job.id, p_lease: job.lease_token, p_revision: state.revision, p_draft: draft, p_signals: signals, ...(knowledge.length ? { p_knowledge: knowledge } : {}) });
  if (finished.error) throw new Error(["PGRST202", "42883"].includes(finished.error.code) ? "scan_migration_required" : finished.error.message);
  if (!finished.data) return checkpoint(job, data, "finish");
}

export async function runDiscoveryQueue(businessId: string | null = null, budgetMs = 110000) {
  const started = Date.now();
  let processed = 0;
  // One leased phase at a time. Leave enough room for a bounded 60s AI call;
  // cron or the next UI wake continues checkpoints, without an open browser.
  while (Date.now() - started < budgetMs - 65000) {
    const claim = await createServiceSupabase().rpc("claim_business_discovery", { p_business: businessId });
    if (claim.error) throw new Error("discovery_queue_unavailable");
    const job = (claim.data as Job[] | null)?.[0];
    if (!job) break;
    try { await processDiscoveryStep(job); }
    catch (error) {
      const message = error instanceof Error && error.message === "scan_migration_required" ? "Ruajtja automatike e njohurive kërkon përditësimin e databazës. Kontakto administratorin." : "Analiza u ndërpre. Do të provohet përsëri; mund të vazhdosh edhe manualisht.";
      await checkpoint(job, job.checkpoint, job.stage, message).catch(() => {});
    }
    processed++;
  }
  return processed;
}
