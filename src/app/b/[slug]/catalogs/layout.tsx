import "@/components/catalogs/catalogs.css";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireEnabledModule(slug, "catalogs");
  return <div className="catalog-workspace">{children}</div>;
}
