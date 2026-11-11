import { createServiceSupabase } from "@/lib/supabase/service";
import { loadSetupStatus } from "./status";
import { setupGateMessage, setupSteps, type SetupStatus } from "./model";

/** Is the agent answering customers, and if not, what is missing.
 * Shown as the onboarding channel step, the "Gati për klientët" card and the
 * live mark in the header; the gate itself stays in launch_business. */
export type ReadinessStep = { key: "knowledge" | "agent" | "test" | "channel" | "live"; title: string; done: boolean; recommended?: boolean; href?: string; action: string };
export type Readiness = {
  live: boolean;
  autoReply: boolean;
  channel: { instagram: string | null; whatsapp: boolean };
  steps: ReadinessStep[];
  /** Why automatic replies cannot be switched on yet; null when they can. */
  blocked: string | null;
  tested: boolean;
  base: string;
};

export function readinessFrom(status: SetupStatus, autoReply: boolean, channel: Readiness["channel"], base: string): Readiness {
  const offer = setupSteps(status).find((step) => step.key === "products");
  const connected = status.connected;
  const live = autoReply && connected && status.agentReady;
  const steps: ReadinessStep[] = [
    { key: "knowledge", title: offer?.title ?? "Shto njohuritë ose produktet", done: !!offer?.done, href: `${base}/${offer?.path ?? "knowledge"}`, action: offer?.action ?? "Hap" },
    { key: "agent", title: "Udhëzimet e Agjentit", done: status.agentReady, href: `${base}/agents`, action: "Hap udhëzimet" },
    { key: "test", title: "Provo Agjentin", done: status.tested, recommended: true, href: `${base}/agents/test`, action: "Provo" },
    { key: "channel", title: "Lidh Instagram-in ose WhatsApp-in", done: connected, href: `${base}/integrations`, action: "Lidh kanalin" },
    { key: "live", title: "Aktivizo përgjigjet automatike", done: live, action: "Aktivizo" },
  ];
  return { live, autoReply, channel, steps, blocked: setupGateMessage(status), tested: status.tested, base };
}

export async function loadReadiness(business: { id: string; slug: string; auto_reply?: boolean | null }): Promise<Readiness | null> {
  try {
    const db = createServiceSupabase();
    const [status, ig, wa, row] = await Promise.all([
      loadSetupStatus(business.id),
      db.from("instagram_connections").select("username").eq("business_id", business.id).eq("status", "connected").maybeSingle(),
      db.from("whatsapp_connections").select("status").eq("business_id", business.id).maybeSingle(),
      business.auto_reply === undefined ? db.from("businesses").select("auto_reply").eq("id", business.id).maybeSingle() : Promise.resolve({ data: { auto_reply: business.auto_reply } }),
    ]);
    if (!status.available) return null;
    const channel = { instagram: ig.data ? ig.data.username ?? "" : null, whatsapp: wa.data?.status === "connected" };
    return readinessFrom(status, Boolean(row.data?.auto_reply), channel, `/b/${business.slug}`);
  } catch {
    return null;
  }
}

/** A small summary for the mobile app's Home card. */
export function readinessSummary(readiness: Readiness | null) {
  if (!readiness) return null;
  const required = readiness.steps.filter((step) => !step.recommended);
  const next = readiness.steps.find((step) => !step.done && !step.recommended) ?? null;
  return {
    live: readiness.live,
    done: required.filter((step) => step.done).length,
    total: required.length,
    tested: readiness.tested,
    // Switching the replies on happens on Kanalet, where the switch lives.
    next: next ? { key: next.key, title: next.title, path: next.href ?? `${readiness.base}/integrations` } : null,
  };
}
