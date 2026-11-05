import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentTestChat } from "@/components/agents/test-chat";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadCommunicationDraft } from "@/lib/agents/communication-configuration";

export const metadata = { title: "ChatLab · Bisedë e plotë | Agjenti.app" };

export default async function LabConversationPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const { slug } = await params;
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) notFound();
  const { draft } = await searchParams;
  const { data: agents, error } = await createServiceSupabase().from("ai_agents")
    .select("id,name,configuration_draft,configuration_revision")
    .eq("business_id", access.business.id).order("name");
  let draftError: string | undefined;
  if (draft) {
    try { await loadCommunicationDraft(access.business.id, draft); }
    catch { draftError = "Drafti mungon, ka ndryshuar ose nuk i përket këtij biznesi. Zgjidh një konfigurim tjetër."; }
  }
  const path = `/admin/chat-lab/${encodeURIComponent(access.business.slug)}`;
  return <>
    <PageHeading title={`ChatLab · ${access.business.name}`} description="Bisedë e plotë: skedarë, audio, historik, rigjenerim, trajnim dhe diagnostikim." />
    <nav aria-label="Navigimi i ChatLab" className="mb-5 flex flex-wrap gap-4">
      <Link href="/admin/chat-lab" className="soft-link">← Bizneset dhe inspektori i motorit</Link>
      <Link href={`/b/${access.business.slug}/agents`} className="soft-link">Konfigurimi i agjentit</Link>
      <Link href={`/b/${access.business.slug}/agents/test`} className="soft-link">Pamja e biznesit</Link>
    </nav>
    <form action={path} className="mb-5 flex flex-wrap items-end gap-3">
      <label className="grid gap-2" htmlFor="lab-configuration">Konfigurimi
        <select id="lab-configuration" name="draft" defaultValue={draft ?? ""}>
          <option value="">Versioni i publikuar</option>
          {(agents ?? []).filter(agent => agent.configuration_draft && agent.configuration_draft.baseRevision === agent.configuration_revision).map(agent =>
            <option key={agent.id} value={agent.id}>Draft · {agent.name}</option>)}
        </select>
      </label>
      <button className="btn btn-secondary" type="submit">Hap konfigurimin</button>
    </form>
    {error && <p role="alert">Lista e drafteve nuk u ngarkua. Rifresko faqen për ta provuar përsëri.</p>}
    {draftError ? <p role="alert">{draftError}</p> : <>
      {draft && <p role="status" className="mb-5">Po provon draftin e ruajtur. Versioni i publikuar nuk ndryshon.</p>}
      <AgentTestChat key={`${access.business.id}:${user.id}:${draft || "published"}`} advanced
        configurationDraft={draft || undefined} slug={access.business.slug} userId={user.id} businessName={access.business.name} />
    </>}
  </>;
}
