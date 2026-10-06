import { KnowledgeWorkspace } from "@/components/dashboard/knowledge-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <KnowledgeWorkspace slug={slug} services />;
}
