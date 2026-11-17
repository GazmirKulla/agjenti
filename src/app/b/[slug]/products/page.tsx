import { loadProducts } from "@/lib/products/load";
import { ProductHeading } from "@/components/products/shared";
import { ProductCatalog } from "@/components/products/catalog";
import { WebsiteConnection } from "@/components/products/website-connection";
import { WebsiteIntegration } from "@/components/dashboard/website-integration";
import { IntegrationDetailsDialog } from "@/components/dashboard/integration-details-dialog";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { fromWebsite } from "@/lib/products/catalog";
import { Suspense } from "react";
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ detail?: string }>;
}) {
  const { slug } = await params;
  const { detail } = await searchParams;
  const data = await loadProducts(slug);
  const t = await getDashboardTranslator();
  return (
    <>
      <ProductHeading
        slug={slug}
        back={false}
        actions="add"
        names={data.items.names}
        title={data.items.names.plural}
        description={data.items.kind.id === "product" ? "Shto dhe menaxho produktet që përdor Agjenti." : `${data.items.kind.description} Agjenti i përdor për t’u përgjigjur klientëve.`}
      />
      <WebsiteConnection slug={slug} businessId={data.business.id} linkedCount={data.products.filter(p => fromWebsite(p) && !p.archived_at).length} />
      <ProductCatalog
        slug={slug}
        products={data.products}
        types={data.types}
        workflows={data.workflows}
        fields={data.items.fields}
        stock={data.items.stock}
      />
      {detail === "website" && <IntegrationDetailsDialog slug={slug} name={t("Webi i biznesit")} closeHref={`/b/${slug}/products`}>
        <Suspense fallback={<p role="status">{t("Duke ngarkuar konfigurimin…")}</p>}><WebsiteIntegration slug={slug} /></Suspense>
      </IntegrationDetailsDialog>}
    </>
  );
}
