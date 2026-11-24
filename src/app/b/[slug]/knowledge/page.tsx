import { KnowledgeWorkspace } from "@/components/dashboard/knowledge-workspace";
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ entry?: string }>;
}) {
  const { slug } = await params;
  const { entry } = await searchParams;
  return <KnowledgeWorkspace slug={slug} openEntry={entry} />;
}
