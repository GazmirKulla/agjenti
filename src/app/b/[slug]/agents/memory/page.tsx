import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { TrainingMemory } from "@/components/agents/training-memory";
import { BackLink } from "@/components/dashboard/ui";

export const metadata = { title: "Preferencat dhe shembujt | Agjenti.app" };
export default async function AgentMemoryPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const fromLab = (await searchParams).from === "chat-lab" && await isPlatformAdmin(user.id);
  return <>
    <PageHeading title="Preferencat dhe shembujt" description="Shembuj përgjigjesh dhe mësime për procese të caktuara. Toni dhe stili për gjithë biznesin ndryshohen te Udhëzimet.">
      <BackLink href={fromLab ? "/admin/chat-lab" : `/b/${slug}/agents`}>{fromLab ? "Chat Lab" : "Sjellja dhe veprimet"}</BackLink>
    </PageHeading>
    <TrainingMemory target={{ slug }} />
  </>;
}
