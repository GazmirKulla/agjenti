import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentSpace } from "@/components/agents/agent-space";
import { TopicTest } from "@/components/agents/topic-test";
import { ProfileEditor } from "@/components/agents/profile-editor";
import { ConfigurationHistory } from "@/components/agents/configuration-history";
import { loadBusinessProfile } from "@/lib/business-profile/service";
import { missingFields } from "@/lib/business-profile/model";
import { saveBusinessProfile } from "@/lib/business-profile/actions";

export const metadata = { title: "Biznesi | Agjenti.app" };

/** Agjenti → Biznesi: the business's public profile in one place, with the agent's test beside it. */
export default async function AgentBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const businessId = access.business.id, base = `/b/${access.business.slug}`;
  const loaded = await loadBusinessProfile(businessId);
  const missing = missingFields(loaded.profile);
  return <>
    <PageHeading title="Biznesi" description={`Profili publik i ${access.business.name}: kush jeni, si ju kontaktojnë, ku ndodheni dhe kur jeni hapur. Agjenti u përgjigjet klientëve nga këto të dhëna.`} />
    <AgentSpace test={<TopicTest slug={access.business.slug} businessId={businessId} businessName={access.business.name} userId={user.id} profileHref="" />}>
      {missing.length > 0 && <p className="profile-missing" role="status">Profili nuk thotë ende: {missing.map(field => field.label.toLowerCase()).join(", ")}. Agjenti këto i thotë si të panjohura dhe nuk shpik vlera.</p>}
      <ProfileEditor initial={loaded.profile} updatedAt={loaded.updatedAt} requestId={randomUUID()} timezone={loaded.timezone} suggestions={loaded.suggestions}
        settingsHref={`${base}/settings/business`} action={saveBusinessProfile.bind(null, access.business.slug)} />
      <ConfigurationHistory slug={access.business.slug} businessId={businessId} />
    </AgentSpace>
  </>;
}
