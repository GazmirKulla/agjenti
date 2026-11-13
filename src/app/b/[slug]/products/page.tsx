import { loadProducts } from "@/lib/products/load";
import { ProductHeading } from "@/components/products/shared";
import { ProductCatalog } from "@/components/products/catalog";
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadProducts(slug);
  return (
    <>
      <ProductHeading
        slug={slug}
        back={false}
        names={data.items.names}
        title={data.items.names.plural}
        description={data.items.kind.id === "product" ? "Shto dhe menaxho produktet që përdor Agjenti." : `${data.items.kind.description} Agjenti i përdor për t’u përgjigjur klientëve.`}
      />
      <ProductCatalog
        slug={slug}
        products={data.products}
        types={data.types}
        workflows={data.workflows}
        fields={data.items.fields}
      />
    </>
  );
}
