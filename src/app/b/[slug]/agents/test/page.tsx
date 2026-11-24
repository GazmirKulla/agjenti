import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { BackLink, PageHeading } from "@/components/dashboard/ui";
import { AgentTestChat } from "@/components/agents/test-chat";
import type { TestKnowledge } from "@/components/agents/test-knowledge";
import { createServiceSupabase } from "@/lib/supabase/service";
export const metadata = { title: "Prova dhe kontrolli | Agjenti.app" };
export default async function AgentTestPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ draft?: string; knowledge?: string }>;
}) {
  const { slug } = await params;
  const { draft, knowledge: focus } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  // Titles only, to name and link the knowledge each reply read; scoped to this business.
  const { data: entries } = await createServiceSupabase().from("knowledge_entries").select("id,title,is_active,intent_key")
    .eq("business_id", access.business.id).limit(1000);
  const knowledge: TestKnowledge = Object.fromEntries((entries ?? []).filter(e => e.intent_key !== "service").map(e => [e.id, { title: e.title, active: e.is_active }]));
  return (
    <>
      <PageHeading
        title="Prova dhe kontrolli"
        description={`Bisedo me agjentin e ${access.business.name} si një klient, shiko çfarë informacioni lexoi dhe korrigjoje aty ku mbahet.`}
      >
        {focus && <BackLink href={`/b/${slug}/knowledge?entry=${encodeURIComponent(focus)}`}>Njohuria</BackLink>}
      </PageHeading>
      {draft && <p role="status" className="mb-5">Po provon draftin e ruajtur. Kjo provë nuk ndryshon dhe nuk verifikon versionin live.</p>}
      <AgentTestChat
        key={`${access.business.id}:${user.id}:${draft ?? "published"}`}
        configurationDraft={draft}
        slug={slug}
        userId={user.id}
        businessName={access.business.name}
        knowledge={knowledge}
        knowledgeFocus={focus}
      />
    </>
  );
}
