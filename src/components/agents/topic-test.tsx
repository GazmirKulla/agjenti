import { AgentTestChat } from "@/components/agents/test-chat";
import type { TestKnowledge } from "@/components/agents/test-knowledge";
import { currentConfigurationRevision } from "@/lib/agent-configuration/service";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * The agent's test beside a topic: the configuration in use (with its version), never unsaved edits, and for each
 * reply which profile parts and knowledge it was given, each with a link to change it.
 */
export async function TopicTest({ slug, businessId, businessName, userId, profileHref }: { slug: string; businessId: string; businessName: string; userId: string; profileHref?: string }) {
  const [revision, entries] = await Promise.all([
    currentConfigurationRevision(businessId).catch(() => null),
    createServiceSupabase().from("knowledge_entries").select("id,title,is_active,intent_key").eq("business_id", businessId).limit(1000),
  ]);
  const knowledge: TestKnowledge = Object.fromEntries((entries.data ?? []).filter(e => e.intent_key !== "service").map(e => [e.id, { title: e.title, active: e.is_active }]));
  return <>
    <p className="muted-copy agent-space-note">Prova përdor konfigurimin në përdorim{revision ? ` (versioni ${revision})` : ""}. Ndryshimet e paruajtura nuk përfshihen.</p>
    <AgentTestChat slug={slug} userId={userId} businessName={businessName} knowledge={knowledge} profileHref={profileHref} />
  </>;
}
