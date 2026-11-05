import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentTestChat } from "@/components/agents/test-chat";
export const metadata = { title: "Provo Agjentin | Agjenti.app" };
export default async function AgentTestPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { slug } = await params;
  const { draft } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return (
    <>
      <PageHeading
        title="Provo Agjentin"
        description={`Bisedo me agjentin e ${access.business.name} si një klient.`}
      />
      <div className="mb-5">
        <Link href={`/b/${slug}/agents`} className="soft-link">
          ← Konfigurimi i agjentit
        </Link>
      </div>
      {draft && <p role="status" className="mb-5">Po provon draftin e ruajtur. Kjo provë nuk ndryshon dhe nuk verifikon versionin live.</p>}
      <AgentTestChat
        key={`${access.business.id}:${user.id}:${draft ?? "published"}`}
        configurationDraft={draft}
        slug={slug}
        userId={user.id}
        businessName={access.business.name}
      />
    </>
  );
}
