import { notFound } from "next/navigation";
import { loadProducts } from "@/lib/products/load";
import { ProductHeading } from "@/components/products/shared";
import { ProductEditor } from "@/components/products/editor";
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const data = await loadProducts(slug);
  const product = data.products.find((p) => p.id === id);
  if (!product) notFound();
  return (
    <>
      <ProductHeading
        slug={slug}
        names={data.items.names}
        title={data.items.titles.detail}
        description="Shiko dhe ndrysho informacionin, çmimin dhe procesin e porosisë."
      />
      <ProductEditor
        key={product.id + JSON.stringify(product)}
        slug={slug}
        product={product}
        types={data.types}
        workflows={data.workflows}
        kind={product.item_kind ?? data.items.kind.id}
      />
    </>
  );
}
