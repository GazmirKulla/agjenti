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
        title="Produktet"
        description="Shto dhe menaxho produktet që përdor Agjenti."
      />
      <ProductCatalog
        slug={slug}
        products={data.products}
        types={data.types}
        workflows={data.workflows}
      />
    </>
  );
}
