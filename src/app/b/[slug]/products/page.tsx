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
        title={`Produktet e ${data.business.name}`}
        description="Zgjidh, krijo dhe menaxho produktet. Shto dorazi, nga CSV ose Instagram. Për shtim me tekst ose audio, përdor Agjentin."
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
