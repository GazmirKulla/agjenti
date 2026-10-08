import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { enqueueDiscovery, runDiscoveryQueue } from "@/lib/discovery/queue";
import { answersFor, mergedReview, signalsFor, withSetupRecommendations } from "@/lib/discovery/proposal";
import { discoveryConflictGroups, editDiscoveryDraft, editReviewPreferences, jobProgress, reviewDashboardProfile, reviewEntityEnabled } from "@/lib/discovery/review";
import { emptyDraft, EntityValidationError, labels, validateForApply, value, type Draft } from "@/lib/business-intelligence/model";
import type { DashboardSignals } from "@/lib/dashboard/modules/types";
import { scanKnowledge, withoutScanKnowledge, knowledgeNotice } from "@/lib/business-intelligence/scan-routing";
import { seedDraft } from "@/lib/business-intelligence/state";
import { parseDashboardProfile } from "@/lib/dashboard/profile/service";
import { businessProfiles, allowedOfferings } from "@/lib/onboarding/rules";
import { discoveryPreviews } from "@/lib/discovery/previews";
import { capturedInstagramProfile } from "@/lib/instagram/captured-profile";
import { parseBusinessProcess } from "@/lib/discovery/business-process";

export const runtime = "nodejs";
export const maxDuration = 180;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function authorize(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) throw new Error("unauthorized");
  return { user, business: access.business };
}
function wake(businessId: string) {
  after(async () => { await runDiscoveryQueue(businessId).catch(() => console.error("[discovery] worker unavailable")); });
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 512000) { await reader.cancel(); throw new Error("invalid_request"); }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_request");
  return body as Record<string, unknown>;
}

export async function GET(request: Request) {
  try {
    const { business } = await authorize(request);
    const db = createServiceSupabase();
    const [state, jobs, connection, intelligence, knowledge] = await Promise.all([
      db.from("business_discovery").select("draft,signals,baseline,revision,intelligence_revision,confirmed_at,source_profile,operating_workflow").eq("business_id", business.id).maybeSingle(),
      db.from("business_discovery_jobs").select("id,source,status,stage,checkpoint,error,input,created_at,next_attempt_at,leased_until").eq("business_id", business.id).order("created_at", { ascending: false }).limit(24),
      db.from("instagram_connections").select("id,username,status,discovery_generation").eq("business_id", business.id).eq("status", "connected").maybeSingle(),
      db.from("business_intelligence").select("data,revision").eq("business_id", business.id).maybeSingle(),
      db.from("knowledge_entries").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("is_active", true),
    ]);
    if (state.error || jobs.error) return json({ available: false, error: "Konfigurimi automatik kërkon përditësimin e databazës. Mund të vazhdosh nga paneli." });
    if (connection.error || intelligence.error || knowledge.error) throw new Error("discovery_unavailable");
    const draft = reviewDraft(state.data, intelligence.data);
    const signals = signalsFor(state.data?.signals?.businessType, state.data?.signals?.offeringTypes);
    const prior = state.data?.baseline?.business?.dashboard_profile;
    const dashboardProfile = reviewDashboardProfile(draft, signals, prior?.source === "manual" ? parseDashboardProfile(prior) : null);
    const profile = capturedInstagramProfile(connection.data, jobs.data ?? [], state.data?.source_profile);
    const process = parseBusinessProcess(state.data?.operating_workflow, state.data?.operating_workflow?.source === "manual");
    return json({ available: true, connection: connection.data, sourceProfile: profile, businessProcess: process ? { name: process.name, stepCount: process.steps.length, enabled: process.enabled } : null, draft, dashboardProfile, signals: state.data?.signals ?? null, revision: state.data?.revision ?? 0, intelligenceRevision: intelligence.data?.revision ?? 0, confirmedAt: state.data?.confirmed_at ?? null, knowledgeCount: knowledge.count ?? 0, pendingKnowledgeCount: scanKnowledge(draft).length,
      jobs: (jobs.data ?? []).map((job) => ({ id: job.id, source: job.source, status: job.status, stage: job.stage, progress: jobProgress(job.stage, job.checkpoint?.nextImage, job.checkpoint?.images?.length, job.checkpoint?.nextText, job.checkpoint?.text?.length), error: job.error, note: job.checkpoint?.note ?? "", warnings: job.checkpoint?.warnings ?? [], postCount: job.checkpoint?.postCount ?? 0, imageCount: job.checkpoint?.images?.length ?? 0, nextImage: job.checkpoint?.nextImage ?? 0, previews: discoveryPreviews(job.source, job.checkpoint), pageCount: job.checkpoint?.pageCount ?? 0, knowledgeCount: job.checkpoint?.knowledgeCount ?? 0, inactiveKnowledgeCount: job.checkpoint?.inactiveKnowledgeCount ?? 0, website: job.source === "website" ? job.input?.url : job.checkpoint?.website, canResume: job.status === "queued" && new Date(job.next_attempt_at).getTime() <= Date.now() || job.status === "running" && new Date(job.leased_until).getTime() <= Date.now() })),
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("unauthorized");
    const { user, business } = await authorize(request);
    const body = await readBody(request);
    if (body.action === "resume") { wake(business.id); return json({ success: "Analiza vazhdon në background." }); }
    if (body.action === "start") {
      if (!["instagram", "website"].includes(String(body.source))) throw new Error("invalid_request");
      const id = await enqueueDiscovery(business.id, user.id, body.source as "instagram" | "website", typeof body.website === "string" ? body.website : undefined, body.force === true);
      wake(business.id);
      return json({ id });
    }
    const db = createServiceSupabase();
    const [state, intelligence] = await Promise.all([
      db.from("business_discovery").select("*").eq("business_id", business.id).single(),
      db.from("business_intelligence").select("data,revision").eq("business_id", business.id).maybeSingle(),
    ]);
    if (state.error || !state.data || intelligence.error) throw new Error("discovery_unavailable");
    if (state.data.confirmed_at && body.action === "confirm") return json({ confirmed: true });
    if (body.revision !== state.data.revision || body.intelligenceRevision !== (intelligence.data?.revision ?? 0)) throw new Error("stale_draft");
    let draft = reviewDraft(state.data, intelligence.data);
    if (body.action === "route_knowledge") {
      const knowledge = scanKnowledge(draft);
      if (!knowledge.length) return json({ knowledgeCount: 0 });
      const routed = await db.rpc("route_discovery_knowledge", { p_business: business.id, p_user: user.id, p_revision: state.data.revision, p_draft: withoutScanKnowledge(draft, knowledge), p_knowledge: knowledge });
      if (routed.error) throw new Error(["PGRST202", "42883"].includes(routed.error.code) ? "scan_migration_required" : routed.error.message);
      revalidatePath(`/b/${business.slug}/knowledge`);
      return json({ knowledgeCount: routed.data.count, inactiveKnowledgeCount: routed.data.inactiveCount, success: knowledgeNotice(routed.data.count) });
    }
    if (body.action === "refresh") {
      const snap = await db.rpc("intelligence_snapshot", { p_business: business.id });
      if (snap.error) throw new Error("discovery_unavailable");
      draft = mergedReview(seedDraft(snap.data), draft);
    } else draft = editDiscoveryDraft(draft, body.edits ?? [], body.resolved ?? []);
    draft = editReviewPreferences(draft, body.reviewPreferences);
    const type = body.businessType ?? state.data.signals?.businessType ?? "other";
    const offers = body.offeringTypes ?? state.data.signals?.offeringTypes ?? [];
    if (typeof type !== "string" || !Object.hasOwn(businessProfiles, type) || !Array.isArray(offers) || offers.some((v) => typeof v !== "string" || !allowedOfferings(type).some(([id]) => id === v))) throw new Error("invalid_request");
    const signals = signalsFor(type, offers);
    draft = withSetupRecommendations(draft, signals, state.data.baseline);
    const profile = draft.entities.find((e) => e.target === "profile");
    if (profile) {
      const prior = profile.facts.find((f) => f.field === "businessType");
      if (prior) { prior.value = type; prior.confirmedByUser = true; }
    }
    if (body.action === "save" || body.action === "refresh") {
      const saved = await db.rpc("save_business_discovery", { p_business: business.id, p_revision: state.data.revision, p_draft: draft, p_signals: signals, p_refresh: body.action === "refresh", p_intelligence_revision: intelligence.data?.revision ?? 0 });
      if (saved.error || !saved.data) throw new Error("stale_draft");
      return json({ saved: true });
    }
    if (body.action !== "confirm" || body.confirmed !== true || !Array.isArray(body.selected) || body.selected.some((id) => typeof id !== "string" || !draft.entities.some((e) => e.id === id))) throw new Error("invalid_request");
    if (body.selected.some((id) => !reviewEntityEnabled(draft.entities.find((e) => e.id === id)!, draft))) throw new Error("invalid_request");
    const ids = new Set(body.selected as string[]);
    const conflicts = discoveryConflictGroups(draft, [...ids]);
    if (conflicts.length) {
      const details = conflicts.map((c) => {
        const entity = draft.entities.find((e) => e.id === c.entityId)!;
        return { entityId: entity.id, field: c.field, name: value(entity, "name") || value(entity, "title") || labels[entity.target], label: labels[c.field] ?? c.field };
      });
      return json({ code: "unresolved_conflicts", error: "Kontrollo fushat me mospërputhje përpara konfirmimit.", conflicts: details }, 400);
    }
    const entities = draft.entities.filter((e) => ids.has(e.id));
    validateForApply(entities);
    for (const entity of entities) for (const fact of entity.facts) fact.confirmedByUser = true;
    const answers = { ...answersFor(profile ? value(profile, "name") || business.name : business.name, signals, draft), onboardingMode: "sources" };
    const priorProfile = state.data.baseline?.business?.dashboard_profile;
    const manualProfile = priorProfile?.source === "manual" ? parseDashboardProfile(priorProfile) : null;
    const generated = reviewDashboardProfile(draft, signals, manualProfile);
    const applied = await db.rpc("confirm_business_discovery", { p_business: business.id, p_user: user.id, p_revision: state.data.revision, p_intelligence_revision: intelligence.data?.revision ?? 0, p_draft: draft, p_entities: entities, p_profile: generated, p_answers: answers });
    if (applied.error) {
      console.error("[discovery] confirmation failed", { code: applied.error.code ?? "unknown" });
      throw new Error(applied.error.message);
    }
    revalidatePath(`/b/${business.slug}`, "layout");
    return json({ confirmed: true, success: "Konfigurimi u ruajt. Provo Agjentin përpara aktivizimit të përgjigjeve automatike." });
  } catch (error) { return failure(error); }
}

function reviewDraft(state: { draft: Draft; intelligence_revision: number; baseline?: Record<string, unknown>; signals?: DashboardSignals } | null, intelligence: { data: Draft; revision: number } | null): Draft {
  // Reconcile only new revisions. Replaying an old intelligence snapshot after
  // a user correction would resurrect conflicts the user already resolved.
  const draft = mergedReview(state?.draft ?? emptyDraft(), !state || (intelligence?.revision ?? 0) > state.intelligence_revision ? intelligence?.data : undefined);
  // Show the same proposed starter instructions that saving/confirming will
  // produce. Existing reviewed agents remain authoritative.
  return state?.baseline && state.signals && draft.entities.some((e) => e.target === "agent") && draft.entities.some((e) => e.target === "profile")
    ? withSetupRecommendations(draft, state.signals, state.baseline) : draft;
}

function failure(error: unknown) {
  if (error instanceof EntityValidationError) {
    return json({ code: "validation_failed", error: "Korrigjo fushat e shënuara përpara konfirmimit.", issues: error.issues }, 400);
  }
  const message = error instanceof Error ? error.message : "";
  const errors: Record<string, string> = {
    scan_migration_required: "Ruajtja automatike e njohurive kërkon përditësimin e databazës. Kontakto administratorin.",
    unauthorized: "Nuk ke qasje në këtë biznes.", stale_draft: "Konfigurimi ndryshoi. Rifresko përmbledhjen dhe provo përsëri.",
    platform_changed: "Ke ndryshuar të dhënat në panel. Rifresko nga paneli përpara konfirmimit.",
    busy: "Analiza po vazhdon. Prit përfundimin përpara konfirmimit.", daily_limit: "Ke arritur kufirin e analizave për sot.",
    unresolved_conflicts: "Zgjidh mospërputhjet e elementeve të përzgjedhura.", invalid_request: "Kontrollo të dhënat e kërkesës.",
    discovery_unavailable: "Konfigurimi nuk u ngarkua. Kontrollo lidhjen dhe migrimin e databazës.",
  };
  // Unknown failures may originate in storage, not in a user's fields.
  return json({ code: Object.hasOwn(errors, message) ? message : "save_failed", error: errors[message] ?? "Konfigurimi nuk u ruajt. Provo përsëri; nëse vazhdon, kontakto mbështetjen." }, message === "unauthorized" ? 403 : 400);
}
