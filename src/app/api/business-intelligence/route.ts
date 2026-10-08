import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
import { transcribeAudio } from "@/lib/business-intelligence/transcription";
import {
  extractWebsite,
  extractInstagram,
} from "@/lib/business-intelligence/ingestion";
import { normalizeSource } from "@/lib/business-intelligence/normalization";
import {
  emptyDraft,
  normalizeDraftCurrencies,
  EntityValidationError,
  fields,
  value,
  equivalent,
  parseEntities,
  mergeDraft,
  targets,
  validateForApply,
  withMissing,
  type Draft,
  type Target,
  type Source,
} from "@/lib/business-intelligence/model";
import { scanKnowledge, withoutScanKnowledge, knowledgeNotice } from "@/lib/business-intelligence/scan-routing";
import { seedDraft, snapshotEntities } from "@/lib/business-intelligence/state";
import { revalidatePath } from "next/cache";
export const runtime = "nodejs";
export const maxDuration = 180;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function authorize(slug: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("unauthorized");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) throw new Error("unauthorized");
  return { user, business: access.business };
}
export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("slug") ?? "";
    const { business } = await authorize(slug);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("business_intelligence")
      .select("data,revision")
      .eq("business_id", business.id)
      .maybeSingle();
    if (error) throw error;
    return json({
      draft: normalizeDraftCurrencies(data?.data ?? emptyDraft()),
      revision: data?.revision ?? 0,
    });
  } catch {
    return json(
      {
        error:
          "Nuk u lexua drafti. Kontrollo sesionin dhe migrimin e databazës.",
      },
      403,
    );
  }
}
export async function POST(request: Request) {
  let sourceId: string | null = null;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ error: "Kërkesë e pavlefshme." }, 403);
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug") ?? "";
    const { user, business } = await authorize(slug);
    const db = createServiceSupabase();
    let file: File | null = null;
    let body: Record<string, unknown>;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const upload = await readAudioForm(request);
      file = upload.file;
      body = upload.raw as Record<string, unknown>;
    } else {
      if (Number(request.headers.get("content-length")) > 500000)
        throw new Error("Kërkesa është shumë e madhe.");
      // Bound streaming input even if content-length is absent.
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Kërkesë bosh.");
      let size = 0;
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 500000) {
          await reader.cancel();
          throw new Error("Kërkesa është shumë e madhe.");
        }
        parts.push(value);
      }
      body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    if (!body || typeof body !== "object")
      throw new Error("Kërkesë e pavlefshme.");
    const state = await db
      .from("business_intelligence")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();
    if (state.error)
      throw new Error("Sistemi kërkon migrimin e ri të databazës.");
    const revision = state.data?.revision ?? 0;
    if (body.revision !== revision)
      throw new Error("Drafti ka ndryshuar në një tab tjetër. Rihap panelin.");
    const snap = await db.rpc("intelligence_snapshot", {
      p_business: business.id,
    });
    if (snap.error) throw snap.error;
    let draft = (state.data?.data as Draft | undefined) ?? seedDraft(snap.data);
    if (state.data) {
      const missing = snapshotEntities(snap.data).filter(
        (live) =>
          !draft.entities.some(
            (e) =>
              e.id === live.id ||
              (e.target === live.target &&
                ["profile", "agent"].includes(e.target)),
          ),
      );
      draft = mergeDraft(draft, missing);
    }
    const action = body.action;
    {
      const edits = body.edits ?? [];
      if (!Array.isArray(edits) || edits.length > 60)
        throw new Error("Ndryshime të pavlefshme.");
      draft = structuredClone(draft);
      for (const edit of edits) {
        const entity = draft.entities.find((e) => e.id === edit.id);
        if (!entity || !edit.values || typeof edit.values !== "object")
          throw new Error("Element i pavlefshëm.");
        for (const [field, v] of Object.entries(edit.values)) {
          if (
            !(fields[entity.target] as readonly string[]).includes(field) ||
            typeof v !== "string" ||
            v.length > 8000
          )
            throw new Error("Fushë e pavlefshme.");
          const prior = entity.facts.find((f) => f.field === field);
          const changed = (prior?.value ?? "") !== v;
          if (changed) {
            const chosen = draft.conflicts.find(
              (c) =>
                c.entityId === entity.id &&
                c.field === field &&
                c.incoming.value === v,
            )?.incoming;
            entity.facts = entity.facts
              .filter((f) => f.field !== field)
              .concat(
                chosen
                  ? {
                      ...chosen,
                      confirmedByUser: true,
                      updatedAt: new Date().toISOString(),
                    }
                  : {
                      field,
                      value: v || null,
                      source: "manual",
                      sourceRef: user.id,
                      confidence: 1,
                      evidence: null,
                      createdAt: prior?.createdAt ?? new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      confirmedByUser: true,
                    },
              );
          }
        }
      }
      const resolved = Array.isArray(body.resolved) ? body.resolved : [];
      draft.conflicts = draft.conflicts.filter(
        (c) => !resolved.includes(`${c.entityId}:${c.field}`),
      );
      draft = normalizeDraftCurrencies(withMissing(draft));
    }
    if (action === "route_knowledge") {
      const knowledge = scanKnowledge(draft);
      if (!knowledge.length) return json({ draft, revision, knowledgeCount: 0 });
      draft = withoutScanKnowledge(draft, knowledge);
      const saved = await db.rpc("save_scanned_intelligence", { p_business: business.id, p_user: user.id, p_revision: revision, p_data: draft, p_baseline: snap.data, p_knowledge: knowledge });
      if (saved.error) {
        if (["PGRST202", "42883"].includes(saved.error.code)) throw new Error("scan_migration_required");
        throw saved.error;
      }
      revalidatePath(`/b/${slug}/knowledge`);
      return json({ draft, revision: saved.data.revision, knowledgeCount: saved.data.count, inactiveKnowledgeCount: saved.data.inactiveCount, note: knowledgeNotice(saved.data.count) });
    }
    if (action === "refresh") {
      draft = mergeDraft(draft, snapshotEntities(snap.data));
      const result = await db
        .from("business_intelligence")
        .update({ data: draft, baseline: snap.data, revision: revision + 1 })
        .eq("business_id", business.id)
        .eq("revision", revision)
        .select("revision")
        .single();
      if (result.error) throw result.error;
      return json({ draft, revision: revision + 1 });
    }
    if (action === "save" || action === "apply") {
      if (action === "apply") {
        if (body.confirmed !== true) throw new Error("Konfirmo rishikimin.");
        const ids = Array.isArray(body.selected) ? body.selected : [];
        const entities = draft.entities.filter((e) => ids.includes(e.id));
        if (draft.conflicts.some((c) => ids.includes(c.entityId)))
          throw new Error("Zgjidh konfliktet e elementeve të përzgjedhura.");
        validateForApply(entities);
        for (const entity of entities)
          for (const fact of entity.facts) fact.confirmedByUser = true;
        const result = await db.rpc("apply_intelligence", {
          p_business: business.id,
          p_user: user.id,
          p_revision: revision,
          p_data: draft,
          p_entities: entities,
        });
        if (result.error) throw result.error;
        revalidatePath(`/b/${slug}`, "layout");
        return json({
          draft,
          revision: result.data,
          success:
            "Të dhënat u aplikuan. Produktet e reja ruhen joaktive për konfigurimin përfundimtar.",
        });
      }
    } else if (action === "ingest") {
      const source = body.source as Source;
      const target = body.target as Target;
      if (
        !["audio", "website", "instagram", "manual", "ai_inferred"].includes(
          source,
        ) ||
        !targets.includes(target)
      )
        throw new Error("Burim i pavlefshëm.");
      const claim = await db.rpc("claim_intelligence_source", {
        p_business: business.id,
        p_user: user.id,
        p_source: source,
      });
      if (claim.error) throw claim.error;
      sourceId = claim.data;
      let text = "";
      let reference = "";
      let note = "";
      if (source === "audio") {
        if (!file) throw new Error("Mungon audioja.");
        text = await transcribeAudio(file);
        reference = `audio:${sourceId}`;
      }
      if (source === "website") {
        const result = await extractWebsite(String(body.text ?? ""));
        ({ text, reference, note } = result);
      }
      if (source === "instagram") {
        const result = await extractInstagram(business.id);
        ({ text, reference, note } = result);
      }
      if (source === "ai_inferred") {
        text = JSON.stringify(snap.data).slice(0, 65000);
        reference = "platform";
      }
      if (source === "manual") {
        text = body.values
          ? JSON.stringify(body.values)
          : String(body.text ?? "").trim();
        reference = `manual:${sourceId}`;
      }
      if (!text || text.length > 65000)
        throw new Error("Jep një përshkrim të vlefshëm.");
      const stored = await db
        .from("business_intelligence_sources")
        .update({ transcript: text, reference })
        .eq("id", sourceId);
      if (stored.error) throw stored.error;
      const entities =
        source === "manual" && body.values && typeof body.values === "object"
          ? parseEntities(
              [
                {
                  target,
                  facts: Object.entries(body.values).map(([field, value]) => ({
                    field,
                    value: value || null,
                    confidence: 1,
                    evidence: null,
                  })),
                },
              ],
              source,
              reference,
              text,
            )
          : await normalizeSource(text, source, reference, target);
      draft = mergeDraft(draft, entities);
      const knowledge = ["website", "instagram"].includes(source) ? scanKnowledge(draft) : [];
      draft = withoutScanKnowledge(draft, knowledge);
      const history = await db
        .from("business_intelligence_sources")
        .update({ extracted: entities, status: "completed" })
        .eq("id", sourceId);
      if (history.error) throw history.error;
      const saved = await db.rpc(knowledge.length ? "save_scanned_intelligence" : "save_intelligence_draft", {
        p_business: business.id,
        p_revision: revision,
        p_data: draft,
        p_baseline: snap.data,
        ...(knowledge.length ? { p_user: user.id, p_knowledge: knowledge } : {}),
      });
      if (saved.error) {
        if (["PGRST202", "42883"].includes(saved.error.code)) throw new Error("scan_migration_required");
        throw saved.error;
      }
      const knowledgeCount = knowledge.length ? saved.data.count : 0;
      if (knowledgeCount) revalidatePath(`/b/${slug}/knowledge`);
      const reviewIds = draft.entities.filter(entity => entity.target === target && entities.some(incoming => incoming.id === entity.id || incoming.target === entity.target && equivalent(value(incoming, "name") || value(incoming, "title"), value(entity, "name") || value(entity, "title")))).map(entity => entity.id);
      return json({ draft, reviewIds, revision: knowledge.length ? saved.data.revision : saved.data, knowledgeCount, inactiveKnowledgeCount: knowledge.length ? saved.data.inactiveCount : 0, note: [note, knowledgeCount ? knowledgeNotice(knowledgeCount) : ""].filter(Boolean).join(" ") });
    } else throw new Error("Veprim i pavlefshëm.");
    const saved = await db.rpc("save_intelligence_draft", {
      p_business: business.id,
      p_revision: revision,
      p_data: draft,
      p_baseline: snap.data,
    });
    if (saved.error) throw saved.error;
    return json({ draft, revision: saved.data });
  } catch (error) {
    if (sourceId)
      await createServiceSupabase()
        .from("business_intelligence_sources")
        .update({ status: "failed" })
        .eq("id", sourceId);
    if (error instanceof EntityValidationError) return json({ code: "validation_failed", error: "Korrigjo fushat e shënuara përpara ruajtjes.", issues: error.issues }, 400);
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String(error.message)
          : "";
    const known: Record<string, string> = {
      scan_migration_required: "Ruajtja automatike e njohurive kërkon përditësimin e databazës. Kontakto administratorin.",
      unauthorized: "Nuk ke qasje në këtë biznes.",
      stale_draft: "Drafti ndryshoi. Rihap panelin.",
      platform_changed:
        "Të dhënat aktive kanë ndryshuar. Kliko «Rilexo të dhënat aktive» dhe rishiko konfliktet.",
      daily_limit: "Ke arritur kufirin prej 30 analizash për sot.",
      busy: "Një analizë tjetër po kryhet. Provo pas pak.",
      invalid_field:
        "Analiza ktheu fusha që nuk mbështeten për këtë seksion. Provo përsëri ose plotëso manualisht.",
      invalid_value:
        "Disa vlera të analizuara ishin të pavlefshme. Provo përsëri ose plotëso manualisht.",
      invalid_extraction:
        "Analiza nuk ktheu një strukturë të vlefshme. Provo përsëri ose ndrysho burimin.",
    };
    return json(
      {
        error:
          known[msg] ??
          (error instanceof Error &&
          !/api|token|key|fetch|json|OpenAI/i.test(msg)
            ? msg
            : "Analiza ose ruajtja dështoi. Drafti i mëparshëm është ruajtur; provo përsëri."),
      },
      msg === "unauthorized" ? 403 : 400,
    );
  }
}
