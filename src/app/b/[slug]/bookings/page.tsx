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
      moduleId="bookings"
      title="Rezervimet"
      description="Menaxho rezervimet dhe kërkesat e klientëve."
    />
  );
}
