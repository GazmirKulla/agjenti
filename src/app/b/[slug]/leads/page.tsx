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
      moduleId="leads"
      title="Leads"
      description="Kërkesat e reja, demo dhe lead të kualifikuara."
    />
  );
}
