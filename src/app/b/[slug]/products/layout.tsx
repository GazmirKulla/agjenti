import "@/components/products/products.css";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireEnabledModule(slug, "products");
  return children;
}
