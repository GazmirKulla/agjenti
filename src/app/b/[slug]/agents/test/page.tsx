import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentTestChat } from "@/components/agents/test-chat";
export const metadata = { title: "Provo Agjentin | Agjenti.app" };
export default async function AgentTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return (
    <>
      <PageHeading
        title="Provo Agjentin"
        description={`Bisedë prove për ${access.business.name}, pa lidhje me Instagram-in.`}
      />
      <div className="mb-5">
        <Link href={`/b/${slug}/agents`} className="soft-link">
          ← Konfigurimi i agjentit
        </Link>
      </div>
      <AgentTestChat
        key={access.business.id}
        slug={slug}
        userId={user.id}
        businessName={access.business.name}
      />
    </>
  );
}
