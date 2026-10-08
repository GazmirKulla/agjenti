import { createServiceSupabase } from "@/lib/supabase/service";
import { extractInstagram, extractWebsite } from "@/lib/business-intelligence/ingestion";
import { normalizeSource } from "@/lib/business-intelligence/normalization";
import { emptyDraft, mergeDraft, type Entity, type Draft } from "@/lib/business-intelligence/model";
import { classifyBusiness, meaningfulEntities, mergedReview } from "./proposal";
import { automaticSetup, businessContext, contextDraft, manualContextSignals, profileKnowledge } from "./context";
import { scanKnowledge, withoutScanKnowledge } from "@/lib/business-intelligence/scan-routing";
import { IMAGE_BATCH_SIZE, type DiscoveryImage } from "./images";
import type { ScanPreview } from "./previews";
import type { InstagramBusinessProfile } from "@/lib/instagram/business-profile";
import { parseBusinessProcess, prepareBusinessProcess, processSources, type BusinessProcess } from "./business-process";
import { rebuildProfileFromModules } from "@/lib/dashboard/profile/generate";
import { discoveryTextBatch } from "./text-batches";
import { onboardingProcess } from "./process-starter";

type Checkpoint = {
  text?: string; reference?: string; note?: string; website?: string | null;
  postCount?: number; images?: DiscoveryImage[]; entities?: Entity[];
  previews?: ScanPreview[]; pageCount?: number;
  nextImage?: number; nextText?: number; warnings?: string[];
  draft?: Draft;
  profile?: InstagramBusinessProfile;
};
type Job = {
  id: string; business_id: string; source: "instagram" | "website";
  user_id?: string | null;
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
    const captured = job.source === "instagram" ? await extractInstagram(job.business_id) : await extractWebsite(job.input.url!, "onboarding");
    // Do not persist the decrypted token, fetch Request, or provider errors.
    const ig = job.source === "instagram" ? captured as Awaited<ReturnType<typeof extractInstagram>> : null;
    const web = job.source === "website" ? captured as Awaited<ReturnType<typeof extractWebsite>> : null;
    const next: Checkpoint = { text: captured.text, reference: captured.reference, note: captured.note, entities: [], images: ig?.images ?? [], postCount: ig?.postCount, website: ig?.website ?? null, profile: ig?.profile, previews: web?.previews ?? [], pageCount: web?.pageCount ?? 0 };
    await validConnection(job);
    return checkpoint(job, next, "text");
  }
  if (job.stage === "text") {
    let entities: Entity[] = [];
    const batch = discoveryTextBatch(data.text ?? "", data.nextText ?? 0);
    try { entities = businessContext(meaningfulEntities(await normalizeSource(batch.text, job.source, data.reference!, "knowledge", [], "onboarding"))); }
    catch (error) {
      // Empty captions are common. Images can still provide the first useful facts.
      if (!(error instanceof Error && error.message.startsWith("Nuk u gjetën"))) throw error;
    }
    const merged = mergeDraft(contextDraft(data.draft ?? { ...emptyDraft(), entities: data.entities ?? [] }), entities);
    return checkpoint(job, { ...data, entities: merged.entities, draft: merged, nextText: batch.next }, !batch.done ? "text" : data.images?.length ? "images" : "finish");
  }
  if (job.stage === "images") {
    const offset = data.nextImage ?? 0;
    const batch = (data.images ?? []).slice(offset, offset + IMAGE_BATCH_SIZE);
    const text = batch.map((image) => `Post: ${image.postUrl ?? image.id}\n${image.caption}\nImage URL: ${image.url}`).join("\n\n");
    const entities = data.entities ?? [];
    let warnings = data.warnings ?? [];
    try {
      const extracted = businessContext(meaningfulEntities(await normalizeSource(text, "instagram", data.reference!, "knowledge", batch, "onboarding")));
      // Merge conflicts are retained in the source checkpoint and final draft.
      const merged = mergeDraft(contextDraft(data.draft ?? { ...emptyDraft(), entities: data.entities ?? [] }), extracted);
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
  let draft = mergedReview(state.draft as Draft, contextDraft(data.draft ?? { ...emptyDraft(), entities: data.entities ?? [] }));
  const signals = (state.signals_source === "manual" && state.signals) || manualContextSignals(state.baseline) || await classifyBusiness(contextDraft(draft));
  const setup = automaticSetup(draft, signals, state.baseline, state.generated_agent);
  // Contact, policies and business descriptions also become source-backed
  // Knowledge, instead of requiring a profile confirmation form.
  draft = mergeDraft(draft, profileKnowledge(draft));
  const previousProcess = parseBusinessProcess(state.operating_workflow, state.operating_workflow?.source === "manual");
  let process: BusinessProcess | null = null;
  const excludedProcess = draft.reviewPreferences?.excludedTargets.includes("workflow") || (draft.reviewPreferences?.enabledModules && !draft.reviewPreferences.enabledModules.includes("workflows"));
  if (!excludedProcess && (!previousProcess || previousProcess.source !== "manual")) {
    try { process = await prepareBusinessProcess(processSources(draft, data.text ?? "", data.reference ?? `instagram:${job.business_id}`, previousProcess)); }
    catch { data.warnings = [...(data.warnings ?? []), "Njohuritë u përgatitën; rrjedha e biznesit mund të plotësohet më vonë te Workflow."]; }
    process = onboardingProcess(signals, process);
  }
  if (process?.enabled && setup.profile.source === "generated" && !draft.reviewPreferences) setup.profile = { ...rebuildProfileFromModules([...setup.profile.enabledModules, "workflows"], signals), source: "generated" };
  const knowledge = scanKnowledge(draft);
  draft = withoutScanKnowledge(draft, knowledge);
  await validConnection(job);
  const finished = await db.rpc("finish_discovery_with_process", { p_job: job.id, p_lease: job.lease_token, p_revision: state.revision, p_draft: draft, p_signals: signals, p_knowledge: knowledge, p_profile: setup.profile, p_answers: setup.answers, p_agent: setup.agent, p_process: process, p_process_revision: state.process_revision ?? 0, p_source_profile: data.profile ?? null, p_warnings: (data.warnings ?? []).slice(-20) });
  if (finished.error) throw new Error(["PGRST202", "42883"].includes(finished.error.code) ? "scan_migration_required" : finished.error.message);
  if (!finished.data) return checkpoint(job, data, "finish");
  if (job.source === "instagram" && data.website && job.user_id) {
    // A public website supplied by the profile enriches context without a form.
    // A rescan must enrich from a fresh website read, not reuse an older result.
    // Enqueue still deduplicates an already-active scan of the same URL.
    await enqueueDiscovery(job.business_id, job.user_id, "website", data.website, true).catch(() => console.error("[discovery] optional website was not queued"));
  }
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
      const message = error instanceof Error && error.message === "scan_migration_required" ? "Konfigurimi automatik kërkon migrimin 20261008160000_business_process.sql në databazë, pas migrimeve ekzistuese. Kontakto administratorin." : "Analiza u ndërpre. Do të provohet përsëri; mund të vazhdosh edhe manualisht.";
      await checkpoint(job, job.checkpoint, job.stage, message).catch(() => {});
    }
    processed++;
  }
  return processed;
}
