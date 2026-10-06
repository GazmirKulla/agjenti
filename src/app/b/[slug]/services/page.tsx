import { KnowledgeWorkspace } from "@/components/dashboard/knowledge-workspace";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireEnabledModule(slug, "services");
  return <KnowledgeWorkspace slug={slug} services />;
}
