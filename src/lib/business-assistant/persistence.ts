import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { assessBusinessCapabilities } from "@/lib/capabilities/assessment";
import { refreshPlanCapability } from "./action-plan";
import { loadSelectedContext, openTicket, type Access, type PlanResult } from "./service";
import { parseUIContext, type AssistantUIContext } from "./context";
import { loadLinearContext } from "./linear-service";
import { loadOrderFlows } from "./orderflow-service";
import { safePlanSnapshot, modelHistory, hasRecoverableWork, type PlanningPreferences, type RecoverablePlan, type ConversationView, type StoredConversation, type StoredMessage, type StoredPlan } from "./persistence-model";

export class PersistenceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function storageError(message: string): never {
  if (/migo_(revision_conflict|request_conflict|busy)/.test(message)) throw new PersistenceError("Biseda ndryshoi ose po përpunohet në një dritare tjetër. Rifresko dhe rishqyrto.", 409);
  if (/migo_not_found/.test(message)) throw new PersistenceError("Biseda nuk është më e disponueshme.", 404);
  if (/migo_forbidden/.test(message)) throw new PersistenceError("Nuk ke më qasje në këtë biznes.", 403);
  throw new PersistenceError("Historiku nuk u ruajt. Provo përsëri; mos e trajto kërkesën si të përfunduar.");
}
export async function writeConversation(access: Access, id: string, operation: string, revision: number | null = null, request: string | null = null, payload: unknown = {}) {
  const { data, error } = await createServiceSupabase().rpc("write_migo_conversation", {
    p_business: access.businessId, p_user: access.userId, p_id: id, p_operation: operation,
    p_revision: revision, p_request: request, p_payload: payload,
  });
  if (error) storageError(error.message);
  return data as StoredConversation & { duplicate?: boolean; conversation?: StoredConversation };
}
export async function readConversation(access: Access, id: string, before?: number, attempt = 0): Promise<ConversationView> {
  if (!isUuid(id)) throw new PersistenceError("Bisedë e pavlefshme.", 400);
  // User JWT + real RLS, including membership revocation and private ownership.
  const db = await createServerSupabase();
  const owner = await db.from("migo_conversations").select("*").eq("id", id).eq("business_id", access.businessId).eq("owner_user_id", access.userId).maybeSingle();
  if (owner.error) storageError(owner.error.message);
  if (!owner.data) throw new PersistenceError("Biseda nuk është më e disponueshme.", 404);
  let query = db.from("migo_messages").select("*").eq("conversation_id", id).order("seq", { ascending: false }).limit(51);
  if (before) query = query.lt("seq", before);
  const [messages, plan] = await Promise.all([query, db.from("migo_plan_snapshots").select("revision,snapshot,preferences")
    .eq("conversation_id", id).eq("revision", owner.data.plan_revision).maybeSingle()]);
  if (messages.error || plan.error) storageError("read_failed");
  const fence = await db.from("migo_conversations").select("revision").eq("id", id).maybeSingle();
  if (fence.error) storageError("read_failed");
  if (!fence.data) throw new PersistenceError("Biseda nuk është më e disponueshme.", 404);
  if (fence.data.revision !== owner.data.revision) {
    if (attempt >= 1) throw new PersistenceError("Biseda po ndryshon. Rifresko përsëri.", 409);
    return readConversation(access, id, before, attempt + 1);
  }
  const rows = (messages.data ?? []).slice(0, 50) as StoredMessage[];
  return { conversation: owner.data as StoredConversation, messages: rows.reverse(),
    before: (messages.data?.length ?? 0) > 50 ? rows[0].seq : null, plan: plan.data as StoredPlan | null };
}
export async function listConversations(access: Access, cursor?: string) {
  const db = await createServerSupabase();
  let query = db.from("migo_conversations").select("id,title,revision,plan_revision,updated_at,pending_request,pending_since")
    .eq("business_id", access.businessId).eq("owner_user_id", access.userId).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(21);
  if (cursor) {
    let parts: string[];
    try { parts = JSON.parse(Buffer.from(cursor, "base64url").toString()); } catch { throw new PersistenceError("Faqëzim i pavlefshëm.", 400); }
    if (!Array.isArray(parts) || !/^[0-9T:.+Z-]{20,40}$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0])) || !isUuid(parts[1])) throw new PersistenceError("Faqëzim i pavlefshëm.", 400);
    query = query.or(`updated_at.lt.${parts[0]},and(updated_at.eq.${parts[0]},id.lt.${parts[1]})`);
  }
  const { data, error } = await query;
  if (error) storageError(error.message);
  const conversations = (data ?? []).slice(0, 20) as StoredConversation[];
  const last = conversations.at(-1);
  return { conversations, next: data && data.length > 20 && last ? Buffer.from(JSON.stringify([last.updated_at, last.id])).toString("base64url") : null };
}

/** Read-only recovery. No preparation ticket, execution or publication can occur here. */
export async function reassessPlan(access: Access, plan: StoredPlan | null) {
  if (!plan) return { plan: null, recovery: { verified: true, message: "" } };
  const snapshot = safePlanSnapshot(plan.snapshot);
  try {
    if (snapshot.context) await loadSelectedContext(access, parseUIContext(snapshot.context));
    for (const id of snapshot.context?.selectedEntityIds ?? []) {
      await loadSelectedContext(access, { page: "products", entryPoint: "contextual", entityType: "product", entityId: id });
    }
    if (snapshot.target) {
      const tables: Record<string, string> = { product: "products", service: "booking_services", knowledge: "knowledge_entries", agent: "ai_agents", booking: "bookings", profile: "businesses" };
      const table = tables[snapshot.target.kind];
      if (!table) throw Error("Ky propozim duhet të përgatitet përsëri.");
      let q = createServiceSupabase().from(table).select("*").eq("id", snapshot.target.id);
      if (table !== "businesses") q = q.eq("business_id", access.businessId);
      else q = q.eq("id", access.businessId);
      const row = await q.maybeSingle();
      if (row.error || !row.data || snapshot.target.updatedAt && row.data.updated_at !== snapshot.target.updatedAt ||
        snapshot.target.revision !== undefined && row.data.revision !== snapshot.target.revision) throw Error("Elementi ndryshoi ose nuk është më i disponueshëm.");
    }
    if (snapshot.visualDraft) {
      const row = await createServiceSupabase().from("visual_workflows").select("revision").eq("business_id", access.businessId).maybeSingle();
      if (!access.modules.includes("workflows") || row.error || (row.data?.revision ?? 0) !== snapshot.visualDraft.revision)
        throw Error("Drafti ndryshoi. Rishqyrto propozimin në editor.");
    }
    if (snapshot.linearDraft) {
      const draft = snapshot.linearDraft;
      const card = await loadLinearContext(access, draft.productId);
      const product = card.products.find(p => p.id === draft.productId);
      const version = card.versions.find(v => v.workflow_id === product?.workflow_id);
      const source = card.versions.find(v => v.workflow_id === (draft.source ?? product?.workflow_id));
      if ((card.draft?.revision ?? 0) !== draft.revision || product?.workflow_id !== draft.workflowId ||
        (version?.id ?? null) !== draft.versionId || (source?.id ?? null) !== draft.sourceVersionId)
        throw Error("Workflow-i i produktit ndryshoi. Përgatite propozimin përsëri.");
    }
    if (snapshot.orderDraft) {
      const draft = snapshot.orderDraft;
      const card = await loadOrderFlows(access, draft.source?.id);
      const flow = card.flows.find(f => f.id === draft.source?.id);
      if (draft.source && !isDeepStrictEqual(flow, draft.source))
        throw Error("Rrjedha e porosive ndryshoi. Përgatite propozimin përsëri.");
      for (const product of draft.products) {
        const row = await loadSelectedContext(access, { page: "products", entryPoint: "contextual", entityType: "product", entityId: product.id });
        if (row?.updated_at !== product.updated_at || row.workflow_id !== product.workflow_id)
          throw Error("Produktet e planit ndryshuan. Përgatite propozimin përsëri.");
      }
    }
    if (snapshot.actionPlan) {
      const assessments = await assessBusinessCapabilities(access.businessId, { userId: access.userId }, {
        keys: snapshot.actionPlan.steps.flatMap(step => step.requiredCapability ? [step.requiredCapability] : []),
      });
      for (const assessment of assessments) snapshot.actionPlan = refreshPlanCapability(snapshot.actionPlan, assessment);
    }
    return { plan: { ...plan, snapshot }, recovery: { verified: true, message: "Plan i rikthyer. Kontrollet u rifreskuan; çdo veprim kërkon miratim të ri." } };
  } catch (error) {
    if (snapshot.actionPlan) snapshot.actionPlan = { ...snapshot.actionPlan, steps: snapshot.actionPlan.steps.map(step =>
      step.readiness === "UNSUPPORTED" ? step : { ...step, readiness: "BLOCKED", capabilityReadiness: null, reasonCode: "recovery_requires_revalidation" }) };
    return { plan: { ...plan, snapshot }, recovery: { verified: false, message: error instanceof Error ? error.message : "Plani kërkon rivlerësim." } };
  }
}

export type DurableRequest = { conversationId?: unknown; requestId?: unknown; revision?: unknown };
export async function persistedTurn(
  access: Access, body: DurableRequest, input: { content: string; context?: unknown; mode: string; fingerprintData?: unknown },
  run: (history: ReturnType<typeof modelHistory>, prior: RecoverablePlan | undefined, preferences: PlanningPreferences) => Promise<PlanResult & { saved?: boolean; outcome?: unknown; recoveryContext?: AssistantUIContext }>,
) {
  if (!isUuid(body.conversationId) || !isUuid(body.requestId) || !Number.isInteger(body.revision) || Number(body.revision) < 0)
    throw new PersistenceError("Kërkesa e bisedës është e pavlefshme.", 400);
  const id = body.conversationId, requestId = body.requestId;
  const context = parseUIContext(input.context);
  const fingerprint = createHash("sha256").update(JSON.stringify([input.mode, input.content, context, input.fingerprintData])).digest("hex");
  const started = await writeConversation(access, id, "begin", Number(body.revision), requestId, { content: input.content, context, fingerprint });
  const view = await readConversation(access, id);
  if (started.duplicate) {
    const db = await createServerSupabase();
    const previous = await db.from("migo_messages").select("kind").eq("conversation_id", id).eq("request_id", requestId).eq("role", "assistant").maybeSingle();
    if (previous.error) storageError(previous.error.message);
    if (!previous.data || previous.data.kind === "interrupted")
      throw new PersistenceError("Kërkesa është ruajtur, por përgjigjja ende nuk është konfirmuar. Mos e dërgo sërish si veprim të ri.", 409);
    return { message: "Kjo kërkesë është trajtuar. U rikthye historia, pa përsëritur veprimin.",
      saved: previous.data.kind === "backend_outcome", recovered: true, persistence: view };
  }
  try {
    const history = modelHistory(view.messages.filter(m => m.request_id !== requestId));
    const data = await run(history, view.plan?.snapshot, view.plan?.preferences ?? {});
    const ticket = data.token ? openTicket(data.token, access) : undefined;
    const targetKind = ticket?.action.split("_")[0];
    const retained = !data.saved && !ticket && !data.actionPlan && !data.preview && hasRecoverableWork(view.plan?.snapshot) ? view.plan?.snapshot : undefined;
    const snapshot = safePlanSnapshot({
      ...retained, version: 1, request: retained?.request ?? input.content, context: data.recoveryContext ?? context, message: data.message,
      ...(data.actionPlan ? { actionPlan: data.actionPlan } : {}),
      ...(data.preview ? { preview: data.preview } : {}),
      ...(ticket?.before && targetKind && ["product", "service", "knowledge", "agent", "booking", "profile"].includes(targetKind) ? { target: { kind: targetKind, id: ticket.id,
        updatedAt: typeof ticket.before.updated_at === "string" ? ticket.before.updated_at : undefined,
        revision: typeof ticket.before.revision === "number" ? ticket.before.revision : undefined } } : {}),
      ...(data.workflow?.proposed ? { visualDraft: { graph: data.workflow.proposed, revision: data.workflow.workspace.revision } } : {}),
      ...(ticket?.action.startsWith("linear_") && ticket.before ? { linearDraft: {
        productId: ticket.id, definition: ticket.values.definition, scope: ticket.values.scope, source: ticket.values.source,
        revision: ticket.before.revision, workflowId: ticket.before.workflowId, versionId: ticket.before.versionId, sourceVersionId: ticket.before.sourceVersionId,
      } as RecoverablePlan["linearDraft"] } : {}),
      ...(ticket?.action.startsWith("orderflow_") ? { orderDraft: {
        action: ticket.action, source: ticket.before, name: ticket.values.name, steps: ticket.values.steps, products: ticket.values.products, scope: ticket.values.scope,
      } as RecoverablePlan["orderDraft"] } : {}),
    });
    const finished = await writeConversation(access, id, "finish", null, requestId, {
      content: (data.message || "Kontrollo propozimin.").slice(0, 12000),
      snapshot, preferences: retained ? view.plan?.preferences ?? {} : {}, ...(data.saved ? { outcome: data.outcome } : {}),
    });
    const persistence = await readConversation(access, id);
    if (persistence.conversation.revision !== finished.revision)
      return { message: "Biseda ndryshoi në një dritare tjetër. U rikthye gjendja më e re; rishqyrto çdo propozim.", recovered: true, persistence };
    // Never persist or return an internal outcome envelope as client-supplied input.
    const { outcome: _outcome, recoveryContext: _context, ...result } = data;
    void _outcome;
    void _context;
    return { ...result, persistence };
  } catch (error) {
    try { await writeConversation(access, id, "fail", null, requestId, { content: "Kërkesa u ndërpre ose rezultati nuk u konfirmua. Kontrollo gjendjen përpara riprovimit." }); } catch { /* Remains visibly pending/interrupted; no success is fabricated. */ }
    throw error;
  }
}
