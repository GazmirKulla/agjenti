import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentSpace } from "@/components/agents/agent-space";
import { ProfileEditor } from "@/components/agents/profile-editor";
import { AgentTestChat } from "@/components/agents/test-chat";
import { ConfigurationHistory } from "@/components/agents/configuration-history";
import type { TestKnowledge } from "@/components/agents/test-knowledge";
import { loadBusinessProfile } from "@/lib/business-profile/service";
import { missingFields } from "@/lib/business-profile/model";
import { saveBusinessProfile } from "@/lib/business-profile/actions";
import { currentConfigurationRevision } from "@/lib/agent-configuration/service";
import { createServiceSupabase } from "@/lib/supabase/service";

export const metadata = { title: "Biznesi | Agjenti.app" };

/** Agjenti → Biznesi: the business's public profile in one place, with the agent's test beside it. */
export default async function AgentBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const businessId = access.business.id, base = `/b/${access.business.slug}`;
  const [loaded, revision, entries] = await Promise.all([
    loadBusinessProfile(businessId),
    currentConfigurationRevision(businessId).catch(() => null),
    createServiceSupabase().from("knowledge_entries").select("id,title,is_active,intent_key").eq("business_id", businessId).limit(1000),
  ]);
  const knowledge: TestKnowledge = Object.fromEntries((entries.data ?? []).filter(e => e.intent_key !== "service").map(e => [e.id, { title: e.title, active: e.is_active }]));
  const missing = missingFields(loaded.profile);
  return <>
    <PageHeading title="Biznesi" description={`Profili publik i ${access.business.name}: kush jeni, si ju kontaktojnë, ku ndodheni dhe kur jeni hapur. Agjenti u përgjigjet klientëve nga këto të dhëna.`} />
    <AgentSpace test={<>
      <p className="muted-copy agent-space-note">Prova përdor konfigurimin në përdorim{revision ? ` (versioni ${revision})` : ""}. Ndryshimet e paruajtura nuk përfshihen.</p>
      <AgentTestChat slug={access.business.slug} userId={user.id} businessName={access.business.name} knowledge={knowledge} profileHref="" />
    </>}>
      {missing.length > 0 && <p className="profile-missing" role="status">Profili nuk thotë ende: {missing.map(field => field.label.toLowerCase()).join(", ")}. Agjenti këto i thotë si të panjohura dhe nuk shpik vlera.</p>}
      <ProfileEditor initial={loaded.profile} updatedAt={loaded.updatedAt} requestId={randomUUID()} timezone={loaded.timezone} suggestions={loaded.suggestions}
        settingsHref={`${base}/settings/business`} action={saveBusinessProfile.bind(null, access.business.slug)} />
      <ConfigurationHistory slug={access.business.slug} businessId={businessId} />
    </AgentSpace>
  </>;
}
