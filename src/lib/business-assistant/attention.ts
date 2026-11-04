import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticatedReadClient } from "@/lib/auth/read-client";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { BriefingError } from "./briefing";
import { hasRecoverableWork } from "./persistence-model";
import { workflowNeedsAttention, type AttentionItem, type AttentionSnapshot } from "./attention-model";

/** Each source is read through the current user's RLS, scoped again by business.
 * No task/status copies, provider calls or business writes are made by a refresh. */
export async function loadAttention(slug: string, request?: Request): Promise<AttentionSnapshot> {
  const identity = await authenticatedReadClient(request);
  if (!identity) throw new BriefingError(401);
  const { db, user } = identity;
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) throw new BriefingError(403);
  const snapshot = await readAttentionEvidence(db, { businessId: access.business.id, userId: user.id, slug: access.business.slug });
  const membership = await db.rpc("current_user_module_allowed", { p_business: access.business.id, p_module: "inbox" });
  if (membership.error) throw new BriefingError(503);
  if (membership.data !== true) throw new BriefingError(403);
  return snapshot;
}
/** Internal source reader, shared with the authenticated route and scheduled monitor.
 * Callers establish the scope; every private source is also filtered by owner. */
export async function readAttentionEvidence(db: SupabaseClient, scope: { businessId: string; userId: string; slug: string }): Promise<AttentionSnapshot> {
  const businessId = scope.businessId, user = { id: scope.userId };
  const base = `/b/${encodeURIComponent(scope.slug)}`;
  const sources: { name: string; read: () => Promise<AttentionItem[]> }[] = [
    { name: "Planet me hapa", read: async () => {
      const result = await db.from("business_operation_plans").select("id,title,state").eq("business_id", businessId).eq("user_id", user.id)
        .in("state", ["pending", "blocked"]).order("updated_at", { ascending: false }).limit(20);
      if (result.error) throw result.error;
      return (result.data ?? []).map(plan => ({ id: `operation-plan:${plan.id}`, kind: "operation_plan" as const, title: plan.title,
        detail: `Plani ${plan.id}: ${plan.state === "blocked" ? "kërkon kontroll të hapit të ndërprerë" : "pret konfirmimin tënd"}.`,
        href: `${base}/activity`, action: "Shiko punët" }));
    } },

    { name: "Planet e tua", read: async () => {
      const result = await db.from("assistant_conversations")
        .select("id,title,plan_revision").eq("business_id", businessId).eq("owner_user_id", user.id)
        .is("deleted_at", null).is("archived_at", null).gt("plan_revision", 0)
        .order("updated_at", { ascending: false }).limit(20);
      if (result.error) throw result.error;
      const plans = await Promise.all((result.data ?? []).map(async conversation => {
        const plan = await db.from("assistant_plan_snapshots").select("snapshot")
          .eq("conversation_id", conversation.id).eq("revision", conversation.plan_revision).maybeSingle();
        if (plan.error) throw plan.error;
        if (!hasRecoverableWork(plan.data?.snapshot)) return null;
        return { id: `conversation:${conversation.id}`, kind: "conversation" as const,
          title: conversation.title, detail: "Ke një propozim të pambyllur. Rishqyrtoje përpara çdo veprimi.",
          href: `${base}?assistantThread=${conversation.id}`, action: "Vazhdo bisedën", conversationId: conversation.id };
      }));
      return plans.filter((item): item is NonNullable<typeof item> => item !== null);
    } },
    { name: "Procesi i biznesit", read: async () => {
      const result = await db.from("visual_workflows").select("draft,published_version_id")
        .eq("business_id", businessId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return [];
      const workflow = result.data;
      let published: unknown = null;
      if (workflow.published_version_id) {
        const version = await db.from("visual_workflow_versions").select("graph")
          .eq("business_id", businessId).eq("id", workflow.published_version_id).single();
        if (version.error) throw version.error;
        published = version.data.graph;
      }
      return workflowNeedsAttention(workflow.draft, published)
        ? [{ id: "workflow:draft", kind: "workflow", title: "Proces me ndryshime të papublikuara",
          detail: "Drafti nuk është ende sjellja aktive. Rishiko ndryshimet dhe provo procesin.", href: `${base}/workflows`, action: "Rishiko procesin" }] : [];
    } },
    { name: "Bisedat e stafit", read: async () => {
      const result = await db.from("conversation_states").select("conversation_id,conversations!inner(id)", { count: "exact", head: true })
        .eq("business_id", businessId).eq("conversations.business_id", businessId).eq("conversations.status", "paused")
        .or("collected->>staffHandoff.eq.true,and(collected->visual->>status.eq.handoff,or(collected->visual->>advisory.is.null,collected->visual->>advisory.eq.false))");
      if (result.error || result.count === null) throw result.error ?? Error("count_unavailable");
      return result.count > 0 ? [{ id: "handoff:open", kind: "handoff", title: `${result.count} biseda të kaluara te stafi`,
        detail: "Kontrollo nëse kërkojnë ndjekje. Kalimi te stafi nuk provon se klienti ende pret përgjigje.", href: `${base}/inbox`, action: "Kontrollo bisedat" }] : [];
    } },
    { name: "Sinkronizimi i rezervimeve", read: async () => {
      const result = await db.from("bookings").select("id", { count: "exact", head: true })
        .eq("business_id", businessId).eq("sync_status", "error");
      if (result.error || result.count === null) throw result.error ?? Error("count_unavailable");
      return result.count > 0 ? [{ id: "booking:sync", kind: "booking_sync", title: `${result.count} rezervime me gabim sinkronizimi`,
        detail: "Rezervimet ekzistojnë. Kontrollo lidhjen dhe sinkronizimin; mos i krijo sërish.", href: `${base}/bookings`, action: "Kontrollo rezervimet" }] : [];
    } },
  ];
  const results = await Promise.allSettled(sources.map(source => source.read()));
  return { items: results.flatMap(result => result.status === "fulfilled" ? result.value : []),
    unavailable: results.flatMap((result, index) => result.status === "rejected" ? [sources[index].name] : []),
    checkedAt: new Date().toISOString() };
}
