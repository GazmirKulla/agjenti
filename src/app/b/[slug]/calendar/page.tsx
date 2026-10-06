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
      moduleId="calendar"
      title="Kalendari"
      description="Orari, slotet e lira dhe ngarkesa e stafit."
    />
  );
}
