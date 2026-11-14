import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { ConversationTraining } from "@/components/training/conversation-training";

export const metadata = { title: "Trajno nga bisedat | Agjenti.app" };
export default async function ConversationTrainingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <>
    <PageHeading eyebrow={access.business.name} title="Trajno nga bisedat" description="Agjenti mëson nga bisedat e tua të vërteta me klientët: si shkruan ti, çfarë pyesin klientët dhe çfarë u përgjigjesh.">
      <Link className="soft-link" href={`/b/${slug}/agents`}>← Agjenti</Link>
    </PageHeading>
    <ConversationTraining slug={slug} />
  </>;
}
