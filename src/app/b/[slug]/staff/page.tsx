import { ModulePlaceholderPage } from "@/components/dashboard/module-placeholder";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ModulePlaceholderPage
      slug={slug}
      moduleId="staff"
      title="Stafi"
      description="Anëtarët e ekipit dhe ngarkesa e tyre."
    />
  );
}
