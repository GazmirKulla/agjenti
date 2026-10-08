import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { TrainingMemory } from "@/components/agents/training-memory";

export const metadata = { title: "Memoria e Agjentit | Agjenti.app" };
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
    <PageHeading eyebrow={access.business.name} title="Memoria e Agjentit" description="Një vend për të kontrolluar dhe përsosur mënyrën si komunikon biznesi yt.">
      <Link className="soft-link" href={fromLab ? "/admin/chat-lab" : `/b/${slug}/agents/test`}>← {fromLab ? "Chat Lab" : "Kthehu te prova"}</Link>
    </PageHeading>
    <TrainingMemory target={{ slug }} />
  </>;
}
